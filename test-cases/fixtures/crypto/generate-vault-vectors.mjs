import assert from "node:assert/strict";
import {argon2Sync, createCipheriv, hkdfSync, pbkdf2Sync} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";

const source = "1d8a1bda4b6c43ec4df0dad8f4578908e13ba322";
const fixtureFile = new URL("./vault-v1-v4.json", import.meta.url);
const sequence = (length, start) => Buffer.from(Array.from({length}, (_, index) => start + index));
const bytes = (value) => Buffer.from(value, "utf8");
const hex = (value) => Buffer.from(value).toString("hex");
const hkdf = (input, salt, info) => Buffer.from(hkdfSync("sha256", input, salt, bytes(info), 32));

function wrap(value, key, nonce) {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  return hex(Buffer.concat([cipher.update(value), cipher.final(), cipher.getAuthTag()]));
}

function vector(version, domain, index) {
  const salt = sequence(16, 16 + index);
  const nonce = sequence(12, 48 + index);
  const dataNonce = sequence(12, 80 + index);
  const urk = sequence(32, 112 + index);
  const accountSecret = hex(sequence(32, 144 + index));
  const entropy = sequence(18, 184 + index);
  const secretKey = "A3-" + hex(entropy).match(/.{6}/g).join("-");
  const password = "synthetic-vault-fixture-" + version;
  const passBytes = bytes(password);
  const legacyInfo = domain + ":kek:v1";
  let kek;
  if (version === 1) {
    const argon = argon2Sync("argon2id", {message: passBytes, nonce: salt, parallelism: 1,
      tagLength: 32, memory: 19456, passes: 2});
    kek = hkdf(argon, bytes(accountSecret), legacyInfo);
  } else if (version === 2) {
    kek = pbkdf2Sync(passBytes, salt, 210000, 32, "sha256");
  } else if (version === 3) {
    kek = hkdf(pbkdf2Sync(passBytes, salt, 210000, 32, "sha256"), bytes(secretKey), legacyInfo);
  } else {
    kek = hkdf(entropy, salt, domain + ":kek:v4");
  }
  const plain = "synthetic legacy vault library " + domain + " v" + version;
  const marker = domain === "rsrs" ? "rsrs:v1:" : "";
  const dataCipher = marker + wrap(bytes(plain), hkdf(urk, Buffer.alloc(0), domain + ":data:v1"), dataNonce);
  return {
    version, domain, kdf_salt: hex(salt), urk_nonce: hex(nonce), wrapped_urk: marker + wrap(urk, kek, nonce),
    unlock_factor: version === 4 ? secretKey : password,
    ...(version === 1 ? {account_secret: accountSecret} : version === 3 ? {secret_key: secretKey} : {}),
    expected_urk_hex: hex(urk),
    data: {nonce_hex: hex(dataNonce), ciphertext: dataCipher, expected_utf8: plain}
  };
}

const vectors = [1, 2, 3, 4].flatMap((version) =>
  ["onememory", "rsrs"].map((domain, offset) => vector(version, domain, (version - 1) * 2 + offset)));
const output = JSON.stringify({schema: 1, synthetic: true, source_repo: "risense-ai/respire-runtime",
  source_commit: source, vectors}, null, 2) + "\n";
if (process.argv[2] === "--write") writeFileSync(fixtureFile, output);
else {
  assert.equal(process.argv.length, 2, "Run without flags to verify the frozen fixture.");
  assert.equal(readFileSync(fixtureFile, "utf8").replaceAll("\r\n", "\n"), output);
  console.log("Verified 8 frozen synthetic Vault vectors (v1-v4 across two data domains).");
}
