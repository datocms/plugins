declare module 'yoastseo/build/scoring/interpreters' {
  export function scoreToRating(score: number | null | undefined): string;
}

declare module 'yoastseo/build/worker/createWorker' {
  export default function createWorker(url: string): Worker;
}

declare module 'yoastseo/build/worker/AnalysisWorkerWrapper' {
  export default class AnalysisWorkerWrapper {
    constructor(worker: Worker);
    initialize(config: unknown): Promise<unknown>;
    analyze(paper: unknown): Promise<{ result: any }>;
    analyzeRelatedKeywords(
      paper: unknown,
      relatedKeywords: Record<string, unknown>,
    ): Promise<{ result: any }>;
  }
}

declare module 'yoastseo/build/values/Paper' {
  export default class Paper {
    constructor(content: string, settings: Record<string, unknown>);
  }
}

declare module 'yoastseo/build/helpers' {
  export function measureTextWidth(text: string): number;
}
