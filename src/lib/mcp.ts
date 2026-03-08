import { App } from '@modelcontextprotocol/ext-apps';

export function initMCP(): App | null {
  try {
    const app = new App();
    return app;
  } catch {
    // Not running inside MCP host
    return null;
  }
}
