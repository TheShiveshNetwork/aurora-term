#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

// Port of the WebView2 remote debugging port
const DEBUG_PORT = process.env.TAURI_DEBUG_PORT || "9222";

let ws = null;
let messageId = 0;
const pendingRequests = new Map();

async function getWebSocketDebuggerUrl() {
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const targets = await res.json();
    
    // Find the page target (Tauri webview)
    const pageTarget = targets.find(t => t.type === "page" || t.url.includes("localhost"));
    if (pageTarget && pageTarget.webSocketDebuggerUrl) {
      return pageTarget.webSocketDebuggerUrl;
    }
    
    // Fallback: use first target with a ws debugger url
    const anyTarget = targets.find(t => t.webSocketDebuggerUrl);
    if (anyTarget) return anyTarget.webSocketDebuggerUrl;
    
    throw new Error("No debugging targets found");
  } catch (err) {
    throw new Error(`Failed to fetch targets from WebView2 remote debugging port ${DEBUG_PORT}: ${err.message}`);
  }
}

async function connectToWebView() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }

  const url = await getWebSocketDebuggerUrl();
  console.error(`Connecting to WebView2 DevTools Protocol at: ${url}`);

  ws = new WebSocket(url);

  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      // Enable Page domain for screenshots
      sendCdpCommand("Page.enable");
      resolve(ws);
    });

    ws.on("message", (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id !== undefined && pendingRequests.has(response.id)) {
          const { resolve, reject } = pendingRequests.get(response.id);
          pendingRequests.delete(response.id);
          if (response.error) {
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        }
      } catch (err) {
        console.error("Error parsing CDP message:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("CDP WebSocket error:", err);
      reject(err);
    });

    ws.on("close", () => {
      console.error("CDP WebSocket connection closed");
      ws = null;
    });
  });
}

function sendCdpCommand(method, params = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const activeWs = await connectToWebView();
      const id = ++messageId;
      pendingRequests.set(id, { resolve, reject });
      activeWs.send(JSON.stringify({ id, method, params }));
    } catch (err) {
      reject(err);
    }
  });
}

// Create the MCP Server
const server = new Server(
  {
    name: "tauri-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const TOOLS = [
  {
    name: "eval_js",
    description: "Evaluate arbitrary JavaScript code in the Tauri application window and return the result.",
    inputSchema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "The JavaScript expression to evaluate (e.g., 'document.title' or 'useAgentStore.getState().status')",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "click_selector",
    description: "Click a DOM element in the Tauri webview matching the specified CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to click (e.g., 'button.btn-primary')",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "get_dom",
    description: "Get the outer HTML content of the entire page or a specific selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "Optional CSS selector to restrict output to (defaults to 'body')",
        },
      },
    },
  },
  {
    name: "take_screenshot",
    description: "Capture a screenshot of the Tauri app window as a Base64-encoded PNG image.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "eval_js": {
        const result = await sendCdpCommand("Runtime.evaluate", {
          expression: args.expression,
          returnByValue: true,
        });
        
        if (result.exceptionDetails) {
          return {
            content: [
              {
                type: "text",
                text: `Exception: ${result.exceptionDetails.exception?.description || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.result?.value ?? result.result),
            },
          ],
        };
      }

      case "click_selector": {
        const jsCode = `
          (() => {
            const el = document.querySelector(${JSON.stringify(args.selector)});
            if (!el) throw new Error("Element not found");
            el.click();
            return "Clicked element successfully";
          })()
        `;
        const result = await sendCdpCommand("Runtime.evaluate", {
          expression: jsCode,
          returnByValue: true,
        });

        if (result.exceptionDetails) {
          return {
            content: [
              {
                type: "text",
                text: `Error clicking element: ${result.exceptionDetails.exception?.description || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: result.result?.value || "Success",
            },
          ],
        };
      }

      case "get_dom": {
        const selector = args.selector || "body";
        const jsCode = `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.outerHTML : "Element not found";
          })()
        `;
        const result = await sendCdpCommand("Runtime.evaluate", {
          expression: jsCode,
          returnByValue: true,
        });

        if (result.exceptionDetails) {
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving DOM: ${result.exceptionDetails.exception?.description || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: result.result?.value || "Element not found",
            },
          ],
        };
      }

      case "take_screenshot": {
        const result = await sendCdpCommand("Page.captureScreenshot", {
          format: "png",
        });

        return {
          content: [
            {
              type: "text",
              text: result.data, // base64 encoded PNG
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool '${name}': ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tauri WebView2 MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start Tauri MCP server:", err);
  process.exit(1);
});
