import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  stringToBytes
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const { RPC_URL, PRIVATE_KEY, MEMORY_VAULT_ADDRESS } = env;


      const abi = [
        "function storeMemoryFor(address user, bytes32 topic, string content)",
        "function getLatestMemory(address user, bytes32 topic) view returns (uint256 timestamp, address writer, string content)",
        "function getMemoryCount(address user, bytes32 topic) view returns (uint256)"
      ];

      const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);

      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(RPC_URL),
      });

      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(RPC_URL),
      });

      const topicHash = (topic: string) => keccak256(stringToBytes(topic));

      const url = new URL(request.url);

      // Handle GET request - return server info
      if (request.method === "GET") {
        return new Response(JSON.stringify({
          name: "memory-vault-mcp",
          version: "1.0.0",
          description: "On-chain memory vault MCP server for Nullshot agents",
          tools: [
            {
              name: "store_memory",
              description: "Store a memory string on-chain under a topic for a user",
              parameters: {
                user_address: "string - Ethereum address of the user",
                topic: "string - Topic/category for the memory",
                content: "string - Memory content to store"
              }
            },
            {
              name: "get_latest_memory",
              description: "Retrieve the latest memory for a user and topic from the blockchain",
              parameters: {
                user_address: "string - Ethereum address of the user",
                topic: "string - Topic/category to retrieve memory from"
              }
            }
          ],
          endpoints: {
            store_memory: "/store-memory",
            get_latest_memory: "/get-memory"
          }
        }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Handle POST request for store_memory
      if (request.method === "POST" && url.pathname === "/store-memory") {
        const body = await request.json() as {
          user_address: string;
          topic: string;
          content: string;
        };

        const { user_address, topic, content } = body;

        if (!user_address || !topic || !content) {
          return new Response(JSON.stringify({
            success: false,
            error: "Missing required fields: user_address, topic, content"
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const hash = topicHash(topic);

        const tx = await walletClient.writeContract({
          address: MEMORY_VAULT_ADDRESS as `0x${string}`,
          abi,
          functionName: "storeMemoryFor",
          args: [user_address as `0x${string}`, hash, content]
        });

        return new Response(JSON.stringify({
          success: true,
          message: `Successfully stored memory for user ${user_address} under topic '${topic}'`,
          tx_hash: tx
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Handle POST request for get_latest_memory
      if (request.method === "POST" && url.pathname === "/get-memory") {
        const body = await request.json() as {
          user_address: string;
          topic: string;
        };

        const { user_address, topic } = body;

        if (!user_address || !topic) {
          return new Response(JSON.stringify({
            success: false,
            error: "Missing required fields: user_address, topic"
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const hash = topicHash(topic);

        const result = await publicClient.readContract({
          address: MEMORY_VAULT_ADDRESS as `0x${string}`,
          abi,
          functionName: "getLatestMemory",
          args: [user_address as `0x${string}`, hash]
        }) as { timestamp: bigint; writer: string; content: string };

        return new Response(JSON.stringify({
          success: true,
          timestamp: Number(result.timestamp),
          writer: result.writer,
          content: result.content
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Handle OPTIONS for CORS
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }

      return new Response(JSON.stringify({
        error: "Not found"
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};