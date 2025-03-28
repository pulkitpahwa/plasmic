import fetch from 'isomorphic-unfetch';

export interface ComponentMeta {
  id: string;
  usedComponents: string[];
  projectId: string;
  name: string;
  cssFile: string;
  path: string | undefined;
  isPage: boolean;
  plumeType?: string;
  entry: string;
  isCode: boolean;
}

export interface PageMeta extends ComponentMeta {
  isPage: true;
  path: string;
  plumeType: never;
  pageMetadata: PageMetadata;
}

export interface PageMetadata {
  path: string;
  title?: string | null;
  description?: string | null;
  openGraphImageUrl?: string | null;
}

export interface GlobalGroupMeta {
  id: string;
  projectId: string;
  name: string;
  type: string;
  contextFile: string;
  useName: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  version: string;
  remoteFonts: FontMeta[];
}

export interface FontMeta {
  url: string;
}

export interface LoaderBundleOutput {
  modules: (CodeModule | AssetModule)[];
  external: string[];
  components: ComponentMeta[];
  globalGroups: GlobalGroupMeta[];
  projects: ProjectMeta[];
}

export interface LoaderHtmlOutput {
  html: string;
}

export interface CodeModule {
  fileName: string;
  code: string;
  imports: string[];
  type: 'code';
}

export interface AssetModule {
  fileName: string;
  source: string;
  type: 'asset';
}

const VERSION = '2';

export class Api {
  private host: string;
  constructor(
    private opts: {
      projects: { id: string; token: string }[];
      host?: string;
    }
  ) {
    this.host = opts.host ?? 'https://codegen.plasmic.app';
  }

  async fetchLoaderData(
    projectIds: string[],
    opts: {
      platform?: 'react' | 'nextjs' | 'gatsby';
      preview?: boolean;
    }
  ) {
    const { platform, preview } = opts;
    const query = new URLSearchParams([
      ['platform', platform ?? 'react'],
      ...projectIds.map((projectId) => ['projectId', projectId]),
    ]).toString();

    const url = `${this.host}/api/v1/loader/code/${
      preview ? 'preview' : 'published'
    }?${query}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: this.makeGetHeaders(),
    });
    if (resp.status >= 400) {
      const error = await resp.json();
      throw new Error(error?.error?.message ?? resp.statusText);
    }
    const json = await resp.json();
    return json as LoaderBundleOutput;
  }

  async fetchHtmlData(opts: {
    projectId: string;
    component: string;
    hydrate?: boolean;
    embedHydrate?: boolean;
  }) {
    const { projectId, component, embedHydrate, hydrate } = opts;
    const query = new URLSearchParams([
      ['projectId', projectId],
      ['component', component],
      ['embedHydrate', embedHydrate ? '1' : '0'],
      ['hydrate', hydrate ? '1' : '0'],
    ]).toString();
    const resp = await fetch(`${this.host}/api/v1/loader/html?${query}`, {
      method: 'GET',
      headers: this.makeGetHeaders(),
    });
    const json = await resp.json();
    return json as LoaderHtmlOutput;
  }

  private makeGetHeaders() {
    return {
      'x-plasmic-loader-version': VERSION,
      ...this.makeAuthHeaders(),
    };
  }

  // @ts-ignore
  private makePostHeaders() {
    return {
      'x-plasmic-loader-version': VERSION,
      'Content-Type': 'application/json',
      ...this.makeAuthHeaders(),
    };
  }

  private makeAuthHeaders() {
    const tokens = this.opts.projects
      .map((p) => `${p.id}:${p.token}`)
      .join(',');
    return {
      'x-plasmic-api-project-tokens': tokens,
    };
  }
}
