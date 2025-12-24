import { ethers } from "hardhat";

async function main() {
  const Factory = await ethers.getContractFactory("Score2048");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  console.log("Score2048 deployed to:", await contract.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
