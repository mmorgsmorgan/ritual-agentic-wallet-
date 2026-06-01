import {
  defineChain,
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  encodeAbiParameters,
  decodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================
// Chain Configuration
// ============================================================

export const ritualChain = defineChain({
  id: 1979,
  name: 'Ritual Chain',
  nativeCurrency: { name: 'RITUAL', symbol: 'RITUAL', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.RITUAL_RPC_URL || 'https://rpc.ritualfoundation.org'],
      webSocket: ['wss://rpc.ritualfoundation.org/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Ritual Explorer',
      url: 'https://explorer.ritualfoundation.org',
    },
  },
});

// ============================================================
// System Contract Addresses
// ============================================================

export const SYSTEM_CONTRACTS = {
  RitualWallet: '0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948' as Address,
  AsyncJobTracker: '0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5' as Address,
  TEEServiceRegistry: '0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F' as Address,
  Scheduler: '0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B' as Address,
  SecretsAccessControl: '0xf9BF1BC8A3e79B9EBeD0fa2Db70D0513fecE32FD' as Address,
  AsyncDelivery: '0x5A16214fF555848411544b005f7Ac063742f39F6' as Address,
  ModelPricingRegistry: '0x7A85F48b971ceBb75491b61abe279728F4c4384f' as Address,
} as const;

// ============================================================
// Precompile Addresses
// ============================================================

export const PRECOMPILES = {
  ONNX: '0x0000000000000000000000000000000000000800' as Address,
  HTTP: '0x0000000000000000000000000000000000000801' as Address,
  LLM: '0x0000000000000000000000000000000000000802' as Address,
  LongHTTP: '0x0000000000000000000000000000000000000805' as Address,
  SovereignAgent: '0x000000000000000000000000000000000000080C' as Address,
  Image: '0x0000000000000000000000000000000000000818' as Address,
  Audio: '0x0000000000000000000000000000000000000819' as Address,
  Video: '0x000000000000000000000000000000000000081A' as Address,
  PersistentAgent: '0x0000000000000000000000000000000000000820' as Address,
  SECP256R1: '0x0000000000000000000000000000000000000100' as Address,
  Ed25519: '0x0000000000000000000000000000000000000009' as Address,
} as const;

// ============================================================
// RitualWallet ABI
// ============================================================

export const ritualWalletAbi = [
  {
    name: 'deposit', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'lockDuration', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'depositFor', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'lockDuration', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'lockUntil', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// ============================================================
// Client Factory
// ============================================================

export function getPublicClient() {
  return createPublicClient({
    chain: ritualChain,
    transport: http(),
  });
}

export function getWalletClient(privateKey: string) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: ritualChain,
    transport: http(),
  });
}

// ============================================================
// Balance Helpers
// ============================================================

/** Get native RITUAL balance for an address */
export async function getNativeBalance(
  address: Address
): Promise<{ wei: bigint; formatted: string }> {
  const client = getPublicClient();
  const balance = await client.getBalance({ address });
  return { wei: balance, formatted: formatEther(balance) };
}

/** Get RitualWallet escrow balance */
export async function getRitualWalletBalance(
  address: Address
): Promise<{
  balance: bigint;
  formatted: string;
  lockUntil: bigint;
  isLocked: boolean;
}> {
  const client = getPublicClient();

  const [balance, lockUntil, currentBlock] = await Promise.all([
    client.readContract({
      address: SYSTEM_CONTRACTS.RitualWallet,
      abi: ritualWalletAbi,
      functionName: 'balanceOf',
      args: [address],
    }),
    client.readContract({
      address: SYSTEM_CONTRACTS.RitualWallet,
      abi: ritualWalletAbi,
      functionName: 'lockUntil',
      args: [address],
    }),
    client.getBlockNumber(),
  ]);

  return {
    balance,
    formatted: formatEther(balance),
    lockUntil,
    isLocked: currentBlock < lockUntil,
  };
}

// ============================================================
// RitualWallet Operations
// ============================================================

/** Deposit RITUAL into RitualWallet escrow */
export async function depositToRitualWallet(
  privateKey: string,
  amountEther: string,
  lockDuration: bigint
): Promise<{ hash: Hex; amount: string }> {
  const walletClient = getWalletClient(privateKey);
  const value = parseEther(amountEther);

  const hash = await walletClient.writeContract({
    address: SYSTEM_CONTRACTS.RitualWallet,
    abi: ritualWalletAbi,
    functionName: 'deposit',
    args: [lockDuration],
    value,
  });

  const publicClient = getPublicClient();
  await publicClient.waitForTransactionReceipt({ hash });

  return { hash, amount: amountEther };
}

/** Withdraw RITUAL from RitualWallet escrow */
export async function withdrawFromRitualWallet(
  privateKey: string,
  amountWei: bigint
): Promise<{ hash: Hex }> {
  const walletClient = getWalletClient(privateKey);

  const hash = await walletClient.writeContract({
    address: SYSTEM_CONTRACTS.RitualWallet,
    abi: ritualWalletAbi,
    functionName: 'withdraw',
    args: [amountWei],
  });

  const publicClient = getPublicClient();
  await publicClient.waitForTransactionReceipt({ hash });

  return { hash };
}

// ============================================================
// Transaction Helpers
// ============================================================

/** Send a raw transaction */
export async function sendTransaction(
  privateKey: string,
  to: Address,
  value: bigint,
  data?: Hex
): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const walletClient = getWalletClient(privateKey);
  const publicClient = getPublicClient();

  const hash = await walletClient.sendTransaction({
    to,
    value,
    data: data || '0x',
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

/** Estimate gas for a transaction */
export async function estimateGas(
  from: Address,
  to: Address,
  value: bigint,
  data?: Hex
): Promise<bigint> {
  const client = getPublicClient();
  return client.estimateGas({
    account: from,
    to,
    value,
    data: data || '0x',
  });
}

/** Get transaction receipt */
export async function getTransactionReceipt(hash: Hex) {
  const client = getPublicClient();
  return client.getTransactionReceipt({ hash });
}

/** Get current block number */
export async function getCurrentBlock(): Promise<bigint> {
  const client = getPublicClient();
  return client.getBlockNumber();
}

// ============================================================
// TEE Service Registry (for precompile executor lookup)
// ============================================================

/** Capability codes used by TEEServiceRegistry */
export const TEE_CAPABILITY = {
  HTTP_CALL: 0,
  LLM: 1,
} as const;

const TEE_REGISTRY_ABI = [
  {
    inputs: [
      { name: 'capability', type: 'uint8' },
      { name: 'checkValidity', type: 'bool' },
    ],
    name: 'getServicesByCapability',
    outputs: [
      {
        type: 'tuple[]',
        components: [
          {
            name: 'node',
            type: 'tuple',
            components: [
              { name: 'paymentAddress', type: 'address' },
              { name: 'teeAddress', type: 'address' },
              { name: 'teeType', type: 'uint8' },
              { name: 'publicKey', type: 'bytes' },
              { name: 'endpoint', type: 'string' },
              { name: 'certPubKeyHash', type: 'bytes32' },
              { name: 'capability', type: 'uint8' },
            ],
          },
          { name: 'isValid', type: 'bool' },
          { name: 'workloadId', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface TeeExecutor {
  teeAddress: Address;
  publicKey: Hex;
  endpoint: string;
}

/** Look up a TEE executor for a given capability. Returns first valid one. */
export async function findTeeExecutor(
  capability: number
): Promise<TeeExecutor> {
  const client = getPublicClient();
  const services = (await client.readContract({
    address: SYSTEM_CONTRACTS.TEEServiceRegistry,
    abi: TEE_REGISTRY_ABI,
    functionName: 'getServicesByCapability',
    args: [capability, true],
  })) as readonly {
    node: {
      paymentAddress: Address;
      teeAddress: Address;
      teeType: number;
      publicKey: Hex;
      endpoint: string;
      certPubKeyHash: Hex;
      capability: number;
    };
    isValid: boolean;
    workloadId: Hex;
  }[];

  if (services.length === 0) {
    throw new Error(`No TEE executors found for capability ${capability}`);
  }

  const first = services[0]!;
  return {
    teeAddress: first.node.teeAddress,
    publicKey: first.node.publicKey,
    endpoint: first.node.endpoint,
  };
}

// ============================================================
// Generic Precompile Call + Result Extraction
// ============================================================

const PRECOMPILE_CALLED_TOPIC = keccak256(
  toHex('PrecompileCalled(address,bytes,bytes)')
);

/**
 * Extract the async output bytes for a given precompile from a settled
 * transaction receipt. Returns null if the precompile hasn't been re-executed
 * with the result injected yet (still in commitment phase).
 */
export function extractPrecompileResult(
  receipt: TransactionReceipt,
  precompileAddress: Address
): Hex | null {
  for (const log of receipt.logs) {
    if (log.topics[0] !== PRECOMPILE_CALLED_TOPIC) continue;

    let decoded: readonly unknown[];
    try {
      decoded = decodeAbiParameters(
        parseAbiParameters('address, bytes, bytes'),
        log.data
      );
    } catch {
      continue;
    }
    const [addr, , output] = decoded as [Address, Hex, Hex];
    if (addr.toLowerCase() !== precompileAddress.toLowerCase()) continue;

    // Unwrap async envelope: (bytes simmedInput, bytes actualOutput)
    try {
      const [, actual] = decodeAbiParameters(
        parseAbiParameters('bytes, bytes'),
        output
      ) as [Hex, Hex];
      return actual;
    } catch {
      return output;
    }
  }
  return null;
}

/**
 * Low-level precompile call: send a raw transaction to a precompile address
 * with the supplied calldata, wait for receipt, and return the receipt.
 * Caller is responsible for encoding the input and decoding the output.
 */
export async function callPrecompile(
  privateKey: string,
  precompileAddress: Address,
  encodedInput: Hex,
  options: { gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {}
): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const walletClient = getWalletClient(privateKey);
  const publicClient = getPublicClient();

  const hash = await walletClient.sendTransaction({
    to: precompileAddress,
    data: encodedInput,
    gas: options.gas ?? 2_000_000n,
    maxFeePerGas: options.maxFeePerGas ?? 30_000_000_000n,
    maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? 2_000_000_000n,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

// ============================================================
// HTTP Precompile (0x0801)
// ============================================================

export const HTTP_METHOD = {
  GET: 1,
  POST: 2,
  PUT: 3,
  DELETE: 4,
  PATCH: 5,
  HEAD: 6,
  OPTIONS: 7,
} as const;

export type HttpMethodName = keyof typeof HTTP_METHOD;

const HTTP_REQUEST_ABI = [
  { type: 'address' },   // executor
  { type: 'bytes[]' },   // encryptedSecrets
  { type: 'uint256' },   // ttl
  { type: 'bytes[]' },   // secretSignatures
  { type: 'bytes' },     // userPublicKey
  { type: 'string' },    // url
  { type: 'uint8' },     // method
  { type: 'string[]' },  // headerKeys
  { type: 'string[]' },  // headerValues
  { type: 'bytes' },     // body
  { type: 'uint256' },   // dkmsKeyIndex
  { type: 'uint8' },     // dkmsKeyFormat
  { type: 'bool' },      // piiEnabled
] as const;

const HTTP_RESPONSE_ABI = [
  { type: 'uint16' },    // statusCode
  { type: 'string[]' },  // headerKeys
  { type: 'string[]' },  // headerValues
  { type: 'bytes' },     // body
  { type: 'string' },    // errorMessage
] as const;

export interface HttpCallParams {
  url: string;
  method: HttpMethodName;
  headers?: Record<string, string>;
  body?: string; // utf-8 string, will be hex-encoded
  ttl?: bigint;
  executor?: Address; // override; defaults to TEE registry lookup
}

export interface HttpCallResult {
  hash: Hex;
  status: 'settled' | 'pending';
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string; // utf-8 decoded
  errorMessage?: string;
  explorer: string;
}

/** Encode an HTTP precompile request. */
export function encodeHttpRequest(
  executor: Address,
  url: string,
  method: number,
  headerKeys: string[],
  headerValues: string[],
  body: Hex,
  ttl: bigint
): Hex {
  return encodeAbiParameters(HTTP_REQUEST_ABI, [
    executor,
    [],
    ttl,
    [],
    '0x',
    url,
    method,
    headerKeys,
    headerValues,
    body,
    0n,
    0,
    false,
  ]);
}

/** Decode an HTTP precompile response. */
export function decodeHttpResponse(actualOutput: Hex): {
  statusCode: number;
  headerKeys: string[];
  headerValues: string[];
  body: Hex;
  errorMessage: string;
} {
  const [statusCode, headerKeys, headerValues, body, errorMessage] =
    decodeAbiParameters(HTTP_RESPONSE_ABI, actualOutput) as [
      number,
      string[],
      string[],
      Hex,
      string,
    ];
  return { statusCode: Number(statusCode), headerKeys, headerValues, body, errorMessage };
}

/** End-to-end: find executor, encode, send, wait, decode. */
export async function callHttpPrecompile(
  privateKey: string,
  params: HttpCallParams
): Promise<HttpCallResult> {
  const executor =
    params.executor ?? (await findTeeExecutor(TEE_CAPABILITY.HTTP_CALL)).teeAddress;
  const headerKeys = Object.keys(params.headers ?? {});
  const headerValues = Object.values(params.headers ?? {});
  const bodyHex: Hex = params.body ? toHex(params.body) : '0x';

  const encoded = encodeHttpRequest(
    executor,
    params.url,
    HTTP_METHOD[params.method],
    headerKeys,
    headerValues,
    bodyHex,
    params.ttl ?? 100n
  );

  const { hash, receipt } = await callPrecompile(
    privateKey,
    PRECOMPILES.HTTP,
    encoded
  );

  const actual = extractPrecompileResult(receipt, PRECOMPILES.HTTP);
  const explorer = `https://explorer.ritualfoundation.org/tx/${hash}`;

  if (!actual || actual === '0x') {
    return { hash, status: 'pending', explorer };
  }

  const decoded = decodeHttpResponse(actual);
  const headersOut: Record<string, string> = {};
  decoded.headerKeys.forEach((k, i) => {
    headersOut[k] = decoded.headerValues[i] ?? '';
  });

  return {
    hash,
    status: 'settled',
    statusCode: decoded.statusCode,
    headers: headersOut,
    body: decoded.body === '0x' ? '' : Buffer.from(decoded.body.slice(2), 'hex').toString('utf-8'),
    errorMessage: decoded.errorMessage,
    explorer,
  };
}

// ============================================================
// LLM Precompile (0x0802)
// ============================================================

const LLM_REQUEST_ABI_SIG = [
  'address, bytes[], uint256, bytes[], bytes,',
  'string, string, int256, string, bool, int256, string, string,',
  'uint256, bool, int256, string, bytes, int256, string, string, bool,',
  'int256, bytes, bytes, int256, int256, string, bool,',
  '(string,string,string)',
].join('');

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LlmCallParams {
  messages: LlmMessage[];
  model?: string;
  maxCompletionTokens?: bigint; // default 4096
  temperatureMilli?: bigint; // 0–2000, default 700 (= 0.7)
  topPMilli?: bigint; // 0–1000, default 1000
  reasoningEffort?: 'low' | 'medium' | 'high';
  ttl?: bigint;
  /** (provider, path, key_ref) — required by current chain ABI */
  convoHistory?: [string, string, string];
  executor?: Address;
}

export interface LlmCallResult {
  hash: Hex;
  status: 'settled' | 'pending';
  hasError?: boolean;
  errorMessage?: string;
  model?: string;
  content?: string;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  explorer: string;
}

/** Encode an LLM precompile request (30-field ABI). */
export function encodeLlmRequest(
  executor: Address,
  messagesJson: string,
  params: {
    model: string;
    ttl: bigint;
    maxCompletionTokens: bigint;
    temperatureMilli: bigint;
    topPMilli: bigint;
    reasoningEffort: string;
    convoHistory: [string, string, string];
  }
): Hex {
  return encodeAbiParameters(parseAbiParameters(LLM_REQUEST_ABI_SIG), [
    executor,
    [],
    params.ttl,
    [],
    '0x',
    messagesJson,
    params.model,
    0n,
    '',
    false,
    params.maxCompletionTokens,
    '',
    '',
    1n,
    true,
    0n,
    params.reasoningEffort,
    '0x',
    -1n,
    'auto',
    '',
    false,
    params.temperatureMilli,
    '0x',
    '0x',
    -1n,
    params.topPMilli,
    '',
    false,
    params.convoHistory,
  ] as unknown as readonly unknown[]);
}

/** Decode the top-level LLM response envelope and pull out the assistant text. */
export function decodeLlmResponse(actualOutput: Hex): {
  hasError: boolean;
  errorMessage: string;
  model: string;
  content: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
} {
  const [hasError, completionData, , errorMessage] = decodeAbiParameters(
    parseAbiParameters('bool, bytes, bytes, string, (string,string,string)'),
    actualOutput
  ) as [boolean, Hex, Hex, string, [string, string, string]];

  if (hasError) {
    return {
      hasError: true,
      errorMessage,
      model: '',
      content: '',
      finishReason: '',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  const [, , , model, , , choicesCount, choicesData, usageData] =
    decodeAbiParameters(
      parseAbiParameters(
        'string, string, uint256, string, string, string, uint256, bytes[], bytes'
      ),
      completionData
    ) as [string, string, bigint, string, string, string, bigint, Hex[], Hex];

  const [promptTokens, completionTokens, totalTokens] = decodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint256'),
    usageData
  ) as [bigint, bigint, bigint];

  let content = '';
  let finishReason = '';
  if (choicesCount > 0n && choicesData.length > 0) {
    const [, finish, messageData] = decodeAbiParameters(
      parseAbiParameters('uint256, string, bytes'),
      choicesData[0]!
    ) as [bigint, string, Hex];
    finishReason = finish;
    const [, contentDecoded] = decodeAbiParameters(
      parseAbiParameters('string, string, string, uint256, bytes[]'),
      messageData
    ) as [string, string, string, bigint, Hex[]];
    content = contentDecoded;
  }

  return {
    hasError: false,
    errorMessage: '',
    model,
    content,
    finishReason,
    usage: {
      promptTokens: Number(promptTokens),
      completionTokens: Number(completionTokens),
      totalTokens: Number(totalTokens),
    },
  };
}

/** End-to-end LLM call: find executor, encode, send, wait, decode. */
export async function callLlmPrecompile(
  privateKey: string,
  params: LlmCallParams
): Promise<LlmCallResult> {
  const executor =
    params.executor ?? (await findTeeExecutor(TEE_CAPABILITY.LLM)).teeAddress;

  const messagesJson = JSON.stringify(params.messages);

  // convoHistory is required by the chain ABI. If caller didn't provide one,
  // default to a placeholder — the executor will error if it can't read it,
  // which is honest behavior for an MVP without DA configured.
  const convoHistory: [string, string, string] = params.convoHistory ?? ['', '', ''];

  const encoded = encodeLlmRequest(executor, messagesJson, {
    model: params.model ?? 'zai-org/GLM-4.7-FP8',
    ttl: params.ttl ?? 300n,
    maxCompletionTokens: params.maxCompletionTokens ?? 4096n,
    temperatureMilli: params.temperatureMilli ?? 700n,
    topPMilli: params.topPMilli ?? 1000n,
    reasoningEffort: params.reasoningEffort ?? 'medium',
    convoHistory,
  });

  const { hash, receipt } = await callPrecompile(
    privateKey,
    PRECOMPILES.LLM,
    encoded,
    { gas: 3_000_000n }
  );

  const actual = extractPrecompileResult(receipt, PRECOMPILES.LLM);
  const explorer = `https://explorer.ritualfoundation.org/tx/${hash}`;

  if (!actual || actual === '0x') {
    return { hash, status: 'pending', explorer };
  }

  const decoded = decodeLlmResponse(actual);
  return {
    hash,
    status: 'settled',
    hasError: decoded.hasError,
    errorMessage: decoded.errorMessage || undefined,
    model: decoded.model,
    content: decoded.content,
    finishReason: decoded.finishReason,
    usage: decoded.usage,
    explorer,
  };
}
