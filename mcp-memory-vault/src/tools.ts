import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Env } from "./types";

export function createTools(env: Env) {
  const { RPC_URL, PRIVATE_KEY, MEMORY_VAULT_ADDRESS } = env;

 
 const abi = [
  "function storeMemoryFor(address user, bytes32 topic, string content)",
  "function getLatestMemory(address user, bytes32 topic) view returns (uint256 timestamp, address writer, string content)",
  "function getMemoryCount(address user, bytes32 topic) view returns (uint256)"
];



  // ---------------------------------------------------------------------
  // CLIENTS
  // ---------------------------------------------------------------------
  const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL)
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL)
  });

  const topicHash = (topic: string) => keccak256(stringToBytes(topic));

  // ---------------------------------------------------------------------
  // HANDLER 1: store_memory
  // ---------------------------------------------------------------------
  const storeMemoryHandler = async ({
    user_address,
    topic,
    content
  }: {
    user_address: string;
    topic: string;
    content: string;
  }) => {
    const hash = topicHash(topic);

    const tx = await walletClient.writeContract({
      address: MEMORY_VAULT_ADDRESS as `0x${string}`,
      abi,
      functionName: "storeMemoryFor",
      args: [user_address as `0x${string}`, hash, content]
    });

    return { tx_hash: tx };
  };

  // ---------------------------------------------------------------------
  // HANDLER 2: get_latest_memory
  // ---------------------------------------------------------------------
  const getLatestMemoryHandler = async ({
    user_address,
    topic
  }: {
    user_address: string;
    topic: string;
  }) => {
    const hash = topicHash(topic);

    // Returned tuple = [timestamp, writer, content]
    const [timestamp, writer, content] = (await publicClient.readContract({
      address: MEMORY_VAULT_ADDRESS as `0x${string}`,
      abi,
      functionName: "getLatestMemory",
      args: [user_address as `0x${string}`, hash]
    })) as [bigint, `0x${string}`, string];

    return {
      timestamp: Number(timestamp),
      writer,
      content
    };
  };

  // return handlers
  return { storeMemoryHandler, getLatestMemoryHandler };
}
