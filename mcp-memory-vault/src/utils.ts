import { McpServerDO } from '@nullshot/mcp';
import { createTools } from "./tools";
import type { Env } from "./types";
import { z } from 'zod';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { storeMemoryHandler, getLatestMemoryHandler } = createTools(env);

    const server = createMcpServer({
      name: "memory-vault-mcp",
      version: "1.0.0",
      description: "On-chain memory vault MCP server for Nullshot agents.",
      
      tools: {
        store_memory: {
          description: 'Store a memory string on-chain under a topic for a user',
          parameters: z.object({
            user_address: z.string().describe('Ethereum address of the user'),
            topic: z.string().describe('Topic/category for the memory'),
            content: z.string().describe('Memory content to store')
          }),
          execute: async ({ user_address, topic, content }) => {
            try {
              const result = await storeMemoryHandler({ user_address, topic, content });
              return {
                success: true,
                data: {
                  message: `Successfully stored memory for user ${user_address} under topic '${topic}'`,
                  tx_hash: result.tx_hash
                }
              };
            } catch (error) {
              throw new Error(`Error storing memory: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },
        
        get_latest_memory: {
          description: 'Retrieve the latest memory for a user and topic from the blockchain',
          parameters: z.object({
            user_address: z.string().describe('Ethereum address of the user'),
            topic: z.string().describe('Topic/category to retrieve memory from')
          }),
          execute: async ({ user_address, topic }) => {
            try {
              const result = await getLatestMemoryHandler({ user_address, topic });
              return {
                success: true,
                data: {
                  timestamp: result.timestamp,
                  writer: result.writer,
                  content: result.content
                }
              };
            } catch (error) {
              throw new Error(`Error retrieving memory: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
    });

    return server.fetch(request, env);
  }
};