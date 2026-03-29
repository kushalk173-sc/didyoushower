/**
 * Compile HydrationAttestationAnchor.sol and deploy to Sepolia (or any EVM chain via RPC).
 *
 * Usage (PowerShell):
 *   $env:SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
 *   $env:PRIVATE_KEY="0xYOUR_TEST_WALLET_PRIVATE_KEY"
 *   npm install
 *   npm run deploy:sepolia
 *
 * Dry-run (compile only):
 *   npm run compile:contract
 */
import solc from "solc";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const contractPath = join(root, "contracts", "HydrationAttestationAnchor.sol");
const source = readFileSync(contractPath, "utf8");

const dryRun = process.argv.includes("--dry-run");

const input = {
  language: "Solidity",
  sources: {
    "contracts/HydrationAttestationAnchor.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  if (fatal.length) {
    console.error(output.errors.map((e) => e.formattedMessage || e.message).join("\n"));
    process.exit(1);
  }
}

const compiled =
  output.contracts["contracts/HydrationAttestationAnchor.sol"]["HydrationAttestationAnchor"];
const abi = compiled.abi;
const bytecode = "0x" + compiled.evm.bytecode.object;

if (dryRun) {
  console.log("Compile OK. Bytecode length:", (bytecode.length - 2) / 2, "bytes");
  process.exit(0);
}

const rpc = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const pk = process.env.PRIVATE_KEY;
if (!rpc || !pk) {
  console.error("Missing env: set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY (0x… deployer key).");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk, provider);
const network = await provider.getNetwork();
console.log("Network chainId:", network.chainId.toString(), "—", await provider.getBlockNumber(), "blocks");

const factory = new ethers.ContractFactory(abi, bytecode, wallet);
console.log("Deploying HydrationAttestationAnchor…");
const contract = await factory.deploy();
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log("");
console.log("Deployed HydrationAttestationAnchor at:", address);
console.log("");
console.log("Update chain-config.js:");
console.log(`  contractAddress: "${address}",`);
console.log(`  chainId: ${network.chainId}n,`);
console.log("Keep readOnlyRpcUrl pointed at this network’s public HTTPS RPC (or your own).");
