export type RenderToolProps<T = Record<string, unknown>> = {
  status: 'inProgress' | 'executing' | 'complete';
  parameters: any;
  result?: string;
};
