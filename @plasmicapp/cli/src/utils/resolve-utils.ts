import L from "lodash";
import { logger } from "../deps";
import * as semver from "./semver";
import { VersionResolution, ProjectVersionMeta } from "../api";
import { CONFIG_FILE_NAME, PlasmicContext } from "./config-utils";
import { flatMap, ensure } from "./lang-utils";
import { HandledError } from "./error";
import { SyncArgs } from "../actions/sync";
import { confirmWithUser } from "./user-utils";

/**
 * Starting at the root, do a BFS of the full dependency tree
 * Because ProjectVersionMeta only stores the (projectId, version),
 * we need to search for the full ProjectVersionMeta of dependencies from `available`
 * @param root
 * @param versionResolution
 */
function walkDependencyTree(
  root: ProjectVersionMeta,
  available: ProjectVersionMeta[]
): ProjectVersionMeta[] {
  const queue: ProjectVersionMeta[] = [root];
  const result: ProjectVersionMeta[] = [];

  const getMeta = (projectId: string, version: string): ProjectVersionMeta => {
    const meta = available.find(
      (m) => m.projectId === projectId && m.version === version
    );
    if (!meta) {
      throw new Error(
        `Cannot find projectId=${projectId}, version=${version} in the sync resolution results.`
      );
    }
    return meta;
  };

  while (queue.length > 0) {
    const curr = ensure(queue.shift());
    result.push(curr);
    queue.push(
      ...L.toPairs(curr.dependencies).map(([projectId, version]) =>
        getMeta(projectId, version)
      )
    );
  }

  return result;
}

/**
 * For a given project, check if its compatible with plasmic.json, plasmic.lock, and user
 * @param meta
 * @param context
 */
async function checkProjectMeta(
  meta: ProjectVersionMeta,
  root: ProjectVersionMeta,
  context: PlasmicContext,
  opts: SyncArgs
): Promise<boolean> {
  const projectId = meta.projectId;
  const newVersion = meta.version;

  /**
   * Best effort, try to get it from plasmic.json, else just return projectId
   * @param pid = projectId
   */
  const getName = (pid: string) => {
    const projectConfig = context.config.projects.find(
      (p) => p.projectId === pid
    );
    if (projectConfig) {
      return `'${projectConfig.projectName}'`;
    } else {
      return projectId;
    }
  };

  // Checks newVersion against plasmic.lock
  const checkVersionLock = async (): Promise<boolean> => {
    const projectLock = context.lock.projects.find(
      (p) => p.projectId === projectId
    );
    const versionOnDisk = projectLock?.version;

    if (semver.isLatest(newVersion)) {
      // Always sync when version set to "latest"
      return true;
    }

    if (!versionOnDisk) {
      // Always sync if we haven't seen sync'ed before
      return true;
    }

    // At this point, we can assume newVersion is always X.Y.Z (not latest)
    if (semver.eq(newVersion, versionOnDisk)) {
      logger.info(
        `Project ${getName(
          projectId
        )}@${newVersion} is already up to date. Skipping...`
      );
      return false;
    }

    if (semver.lt(newVersion, versionOnDisk)) {
      meta === root
        ? logger.warn(
            `The local version of ${getName(
              projectId
            )} (${versionOnDisk}) is higher than requested version @${newVersion}. Plasmic does not support downgrading a project. You should consider updating the version range in ${CONFIG_FILE_NAME}. Skipping...`
          )
        : logger.warn(
            `${getName(root.projectId)} uses ${getName(
              projectId
            )}@${newVersion}, but your code has ${getName(
              projectId
            )}@${versionOnDisk}. You should consider upgrading this dependency in Plasmic Studio. Skipping...`
          );
      return false;
    }

    if (semver.gt(newVersion, versionOnDisk)) {
      if (meta === root) {
        logger.info(`Updating ${getName(projectId)} to ${newVersion}`);
        return true;
      } else {
        logger.info(
          `${getName(root.projectId)} uses ${getName(
            projectId
          )}@${newVersion}, but your code has version ${versionOnDisk}`
        );
        return await confirmWithUser(
          `Do you want to upgrade ${getName(projectId)} to ${newVersion}?`,
          opts.yes
        );
      }
    }

    throw new Error(
      `Error comparing version=${newVersion} with the version found in plasmic.lock (${versionOnDisk}) for ${getName(
        projectId
      )}`
    );
  };

  // Checks newVersion against plasmic.json
  const checkVersionRange = async (): Promise<boolean> => {
    const projectConfig = context.config.projects.find(
      (p) => p.projectId === projectId
    );
    const versionRange = projectConfig?.version;
    // If haven't seen this before
    if (!versionRange) {
      return (
        projectId === root.projectId || // Bypass prompt if top-level project
        (await confirmWithUser(
          `${getName(root.projectId)} uses ${getName(
            projectId
          )}@${newVersion}, which has never been synced before. Do you want to sync it down?`,
          opts.yes
        ))
      );
    }

    // If satisfies range in plasmic.json
    if (semver.satisfies(newVersion, versionRange)) {
      return true;
    }

    logger.warn(
      `${getName(
        projectId
      )}@${newVersion} falls outside the range specified in ${CONFIG_FILE_NAME} (${versionRange})\nTip: To avoid this warning in the future, update your ${CONFIG_FILE_NAME}.`
    );
    return await confirmWithUser("Do you want to force it?", opts.force, "n");
  };

  return (await checkVersionLock()) && (await checkVersionRange());
}

/**
 * Checks the versionResolution with plasmic.json, plasmic.lock, and user prompts
 * to compute which projects should be synced
 * @param versionResolution
 * @param context
 */
export async function checkVersionResolution(
  versionResolution: VersionResolution,
  context: PlasmicContext,
  opts: SyncArgs
): Promise<ProjectVersionMeta[]> {
  // Fail if there's nothing to sync
  if (versionResolution.projects.length <= 0) {
    throw new HandledError(
      `Found nothing to sync. Make sure the projectId and version values are valid in ${CONFIG_FILE_NAME}.`
    );
  }

  const seen: ProjectVersionMeta[] = [];
  const result: ProjectVersionMeta[] = [];
  for (const root of versionResolution.projects) {
    const queue = opts.nonRecursive
      ? [root]
      : walkDependencyTree(root, versionResolution.dependencies).reverse();
    for (const m of queue) {
      // If we haven't seen this yet
      if (
        !seen.find(
          (p) => p.projectId === m.projectId && p.version === m.version
        )
      ) {
        if (await checkProjectMeta(m, root, context, opts)) {
          result.push(m);
        }
        seen.push(m);
      }
    }
  }

  // Ignore repeats
  return result;
}

export function getDependencies(
  projectId: string,
  version: string,
  versionResolution: VersionResolution
) {
  const filterFn = (m: ProjectVersionMeta) =>
    m.projectId === projectId && m.version === version;
  const meta =
    versionResolution.projects.find(filterFn) ??
    versionResolution.dependencies.find(filterFn);

  return meta?.dependencies;
}
