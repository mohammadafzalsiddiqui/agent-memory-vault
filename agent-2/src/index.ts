import "dotenv/config";
import readline from "node:readline";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, keccak256, stringToBytes } from "viem";
import { sepolia } from "viem/chains";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";


// ------------------------------------------
// ENV INTERFACE
// ------------------------------------------
interface Env {
  ANTHROPIC_API_KEY?: string;
  RPC_URL?: string;
  MEMORY_VAULT_ADDRESS?: string;
  USER_ADDRESS?: string;
  MODEL_ID?: string;
}


// ------------------------------------------
// LOAD WRANGLER.JSONC VARS
// ------------------------------------------
function loadWranglerVars(): Env {
  try {
    const path = join(process.cwd(), "wrangler.jsonc");
    const content = readFileSync(path, "utf-8");

    let jsonContent = "";
    let inString = false;
    let escape = false;

    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      const next = content[i + 1];

      if (escape) {
        jsonContent += c;
        escape = false;
        continue;
      }

      if (c === "\\" && inString) {
        jsonContent += c;
        escape = true;
        continue;
      }

      if (c === '"') {
        inString = !inString;
        jsonContent += c;
        continue;
      }

      if (!inString) {
        // Remove // comments
        if (c === "/" && next === "/") {
          while (i < content.length && content[i] !== "\n") i++;
          continue;
        }

        // Remove /* */ comments
        if (c === "/" && next === "*") {
          i += 2;
          while (i < content.length - 1) {
            if (content[i] === "*" && content[i + 1] === "/") {
              i += 2;
              break;
            }
            i++;
          }
          continue;
        }
      }

      jsonContent += c;
    }

    // Remove trailing commas
    jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1");

    const config = JSON.parse(jsonContent);
    console.log("✅ Loaded environment variables from wrangler.jsonc");
    return config.vars || {};
  } catch (err: any) {
    console.warn("⚠️ Could not load wrangler.jsonc:", err.message);
    return {};
  }
}


// ------------------------------------------
// ENV HANDLER
// ------------------------------------------
function getEnv(env?: Env) {
  const vars = loadWranglerVars();
  const safe = (v?: string) => (v?.trim() ? v.trim() : undefined);

  return {
    ANTHROPIC_API_KEY:
      safe(env?.ANTHROPIC_API_KEY) ||
      safe(vars.ANTHROPIC_API_KEY) ||
      safe(process.env.ANTHROPIC_API_KEY) ||
      "",

    RPC_URL: safe(env?.RPC_URL) || safe(vars.RPC_URL) || safe(process.env.RPC_URL) || "",

    MEMORY_VAULT_ADDRESS: (safe(env?.MEMORY_VAULT_ADDRESS) ||
      safe(vars.MEMORY_VAULT_ADDRESS) ||
      safe(process.env.MEMORY_VAULT_ADDRESS)) as `0x${string}`,

    USER_ADDRESS: (safe(env?.USER_ADDRESS) ||
      safe(vars.USER_ADDRESS) ||
      safe(process.env.USER_ADDRESS)) as `0x${string}`,

    MODEL_ID:
      safe(env?.MODEL_ID) ||
      safe(vars.MODEL_ID) ||
      safe(process.env.MODEL_ID) ||
      "claude-sonnet-4-20250514"
  };
}


// ------------------------------------------
// INITIALIZE
// ------------------------------------------
const config = getEnv();

if (!config.ANTHROPIC_API_KEY || !config.RPC_URL || !config.MEMORY_VAULT_ADDRESS || !config.USER_ADDRESS) {
  console.error("❌ Missing environment variables. Check wrangler.jsonc vars or .env");
  process.exit(1);
}

const anthropic = createAnthropic({ apiKey: config.ANTHROPIC_API_KEY });
const RPC_URL = config.RPC_URL;
const MEMORY_VAULT_ADDRESS = config.MEMORY_VAULT_ADDRESS;
const USER_ADDRESS = config.USER_ADDRESS;
const MODEL_ID = config.MODEL_ID;


// ------------------------------------------
// ABI (READ FUNCTIONS ONLY)
// ------------------------------------------
const abi = [
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bytes32", "name": "topic", "type": "bytes32" }
    ],
    "name": "getLatestMemory",
    "outputs": [
      {
        "components": [
          { "internalType": "uint256", "name": "timestamp", "type": "uint256" },
          { "internalType": "address", "name": "writer", "type": "address" },
          { "internalType": "string", "name": "content", "type": "string" }
        ],
        "internalType": "struct MemoryVault.Memory",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bytes32", "name": "topic", "type": "bytes32" }
    ],
    "name": "getMemoryCount",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bytes32", "name": "topic", "type": "bytes32" },
      { "internalType": "uint256", "name": "index", "type": "uint256" }
    ],
    "name": "getMemory",
    "outputs": [
      {
        "components": [
          { "internalType": "uint256", "name": "timestamp", "type": "uint256" },
          { "internalType": "address", "name": "writer", "type": "address" },
          { "internalType": "string", "name": "content", "type": "string" }
        ],
        "internalType": "struct MemoryVault.Memory",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];


// ------------------------------------------
// Setup Public Client
// ------------------------------------------
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});


// ------------------------------------------
// UTILS
// ------------------------------------------
function topicHash(topic: string) {
  return keccak256(stringToBytes(topic));
}

const knownTopics = [
  "identity_profile",
  "preferences",
  "risk_profile",
	"user_identity",
	"personal_identity",
  "wallet_profile",
  "goals"
];


// ------------------------------------------
// FETCH ALL MEMORIES OF USER
// ------------------------------------------
async function fetchUserMemories() {
  const results: any[] = [];

  for (const topic of knownTopics) {
    try {
      const hash = topicHash(topic);
      const count = await publicClient.readContract({
        address: MEMORY_VAULT_ADDRESS,
        abi,
        functionName: "getMemoryCount",
        args: [USER_ADDRESS, hash]
      });

      for (let i = 0; i < Number(count); i++) {
        const mem = await publicClient.readContract({
          address: MEMORY_VAULT_ADDRESS,
          abi,
          functionName: "getMemory",
          args: [USER_ADDRESS, hash, i]
        }) as any;

        results.push({
          topic,
          content: mem.content,
          timestamp: Number(mem.timestamp),
          writer: mem.writer
        });
      }
    } catch (err) {
      // Ignore topics with no memory
    }
  }

  return results;
}


// ------------------------------------------
// AGENT REASONING WITH MEMORY
// ------------------------------------------
async function replyWithMemories(userMessage: string, memories: any[]) {
  const memoryText =
    memories.length === 0
      ? "No on-chain memories found."
      : memories.map(m => `- (${m.topic}) ${m.content}`).join("\n");

  const { text } = await generateText({
    model: anthropic(MODEL_ID),
    system: `
You are Agent 2 — a read-only memory agent.
You analyze the user's on-chain long-term memories and answer questions based on them.
NEVER invent new memories. Only use what is stored.
`,
    prompt: `
Retrieved on-chain memories:
${memoryText}

User: "${userMessage}"
`,
    temperature: 0.4
  });

  return text;
}


// ------------------------------------------
// CLI LOOP
// ------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  console.log("🤖 Agent 2 — On-chain Memory Reader (Sepolia)");
  console.log("Ask anything. Example:");
  console.log("- What is my name?");
  console.log("- What preferences do you have stored?");
  console.log("- Summarize my identity.\n");

  while (true) {
    const userMessage: string = await new Promise(resolve => rl.question("👤 You: ", resolve));

    const memories = await fetchUserMemories();

    const reply = await replyWithMemories(userMessage, memories);

    console.log(`\n🤖 Agent 2: ${reply}\n`);
  }
}

main();
