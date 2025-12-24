export type EIP1193Provider = {
  request: (args: { method: string; params?: any[] | Record<string, any> }) => Promise<any>;
};
