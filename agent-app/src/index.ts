import "dotenv/config";
import readline from "node:readline";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes
} from "viem";

import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";


// ---------------------------
// ENV INTERFACE
// ---------------------------
interface Env {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  RPC_URL?: string;
  MEMORY_VAULT_ADDRESS?: string;
  USER_ADDRESS?: string;
  AGENT_PRIVATE_KEY?: string;
  AI_PROVIDER?: string;
  MODEL_ID?: string;
}


// ---------------------------
// LOAD WRANGLER.JSONC VARS
// ---------------------------
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


// ---------------------------
// ENV HANDLER
// ---------------------------
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

    AGENT_PRIVATE_KEY:
      safe(env?.AGENT_PRIVATE_KEY) ||
      safe(vars.AGENT_PRIVATE_KEY) ||
      safe(process.env.AGENT_PRIVATE_KEY) ||
      "",

    MODEL_ID:
      safe(env?.MODEL_ID) ||
      safe(vars.MODEL_ID) ||
      safe(process.env.MODEL_ID) ||
      "claude-3-5-sonnet-20241022"
  };
}


// ---------------------------
// INITIALIZE
// ---------------------------
function initialize(env?: Env) {
  const config = getEnv(env);

  if (!config.ANTHROPIC_API_KEY || !config.RPC_URL || !config.MEMORY_VAULT_ADDRESS || !config.USER_ADDRESS || !config.AGENT_PRIVATE_KEY) {
    console.error("❌ Missing critical environment variables");
    process.exit(1);
  }

  const anthropic = createAnthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const account = privateKeyToAccount(`0x${config.AGENT_PRIVATE_KEY}`);

  return { config, anthropic, account };
}

const { config, anthropic, account } = initialize();


// ---------------------------
// ✔ CORRECT ABI (YOUR ABI PASTED HERE)
// ---------------------------
const abi = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": true, "internalType": "bytes32", "name": "topic", "type": "bytes32" },
      { "indexed": false, "internalType": "uint256", "name": "index", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "writer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
    ],
    "name": "MemoryStored",
    "type": "event"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bytes32", "name": "topic", "type": "bytes32" }
    ],
    "name": "getLatestMemory",
    "outputs": [
      {
        "components": [
          { "internalType": "uint256", "name": "timestamp", "type": "uintuint256" },
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
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bytes32", "name": "topic", "type": "bytes32" }
    ],
    "name": "getMemoryCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bytes32", "name": "topic", "type": "bytes32" },
      { "internalType": "string", "name": "content", "type": "string" }
    ],
    "name": "storeMemoryFor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];


// ---------------------------
// VIEM CLIENTS
// ---------------------------
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(config.RPC_URL)
});

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(config.RPC_URL)
});


// ---------------------------
// UTILITIES
// ---------------------------
function topicHash(topic: string) {
  return keccak256(stringToBytes(topic));
}


// ---------------------------
// FETCH LATEST MEMORY
// ---------------------------
async function getLatestMemory(topic: string): Promise<any | null> {
  try {
    const hash = topicHash(topic);
    const result = await publicClient.readContract({
      address: config.MEMORY_VAULT_ADDRESS,
      abi,
      functionName: "getLatestMemory",
      args: [config.USER_ADDRESS, hash]
    }) as any;

    return {
      topic,
      content: result.content,
      timestamp: Number(result.timestamp),
      writer: result.writer
    };
    
  } catch {
    return null;
  }
}


// ---------------------------
// STORE MEMORY
// ---------------------------
async function storeMemory(topic: string, content: string): Promise<string> {
  const hash = topicHash(topic);

  const txHash = await walletClient.writeContract({
    address: config.MEMORY_VAULT_ADDRESS,
    abi,
    functionName: "storeMemoryFor",
    args: [config.USER_ADDRESS, hash, content]
  });

  return txHash;
}


// ---------------------------
// MEMORY DECISION MODEL
// ---------------------------
const MemoryDecisionSchema = z.object({
  should_store: z.boolean(),
  topic: z.string().optional(),
  summary: z.string().optional()
});

async function decideMemory(userMessage: string, memories: any[]) {
  const memoriesText =
    memories.length === 0
      ? "No existing memories."
      : memories.map((m) => `- [${m.topic}] ${m.content}`).join("\n");

  const systemPrompt = `
Decide whether the user's message contains long-term info.

Return ONLY JSON:
{
  "should_store": boolean,
  "topic": string | null,
  "summary": string | null
}
`;

  const { text } = await generateText({
    model: anthropic(config.MODEL_ID),
    system: systemPrompt,
    prompt: `
Memories:
${memoriesText}

User: "${userMessage}"
`,
    temperature: 0.2
  });

  try {
    return MemoryDecisionSchema.parse(JSON.parse(text));
  } catch {
    console.log("⚠ Parse error in memory decision JSON.");
    return { should_store: false };
  }
}


// ---------------------------
// USER ANSWER MODEL
// ---------------------------
async function answerUser(userMessage: string, memories: any[]) {
  const memoriesContext =
    memories.length === 0
      ? "No memories stored."
      : memories.map((m) => `- [${m.topic}] ${m.content}`).join("\n");

  const systemPrompt = `
You are a memory-aware assistant.
Use on-chain long-term memories to provide helpful responses.
`;

  const { text } = await generateText({
    model: anthropic(config.MODEL_ID),
    system: systemPrompt,
    prompt: `
Memories:
${memoriesContext}

User: "${userMessage}"
`,
    temperature: 0.5
  });

  return text;
}


// ---------------------------
// CLI LOOP
// ---------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log("🧠 Memory Agent – Sepolia");
  console.log("Type a message:\n");

  while (true) {
    const msg = await new Promise<string>((resolve) =>
      rl.question("👤 You: ", resolve)
    );

    const topics = ["identity_profile", "preferences", "risk_profile"];
    const memories: any[] = [];

    for (const t of topics) {
      const m = await getLatestMemory(t);
      console.log("Memory:", m);
      if (m) memories.push(m);
    }
    console.log("Memories:", memories);

    const reply = await answerUser(msg, memories);
    console.log(`\n🤖 Agent: ${reply}\n`);

    const decision = await decideMemory(msg, memories);

    if (decision.should_store && decision.topic && decision.summary) {
      console.log(`📌 Storing memory (${decision.topic})...`);
      try {
        const tx = await storeMemory(decision.topic, decision.summary);
        console.log(`✅ Stored on-chain. Tx: ${tx}\n`);
      } catch (err) {
        console.error("❌ Failed to store memory:", err);
      }
    } else {
      console.log("📝 No memory stored.\n");
    }
  }
}

main();
