import { App } from '@modelcontextprotocol/ext-apps';

export function initMCP(): App | null {
  try {
    const app = new App({ name: 'lejonet', version: '0.0.1' }, {});
    return app;
  } catch {
    // Not running inside MCP host
    return null;
  }
}
