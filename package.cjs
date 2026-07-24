const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const args = process.argv.slice(2);
const browserArg = args.find((arg) => arg.startsWith("--browser="));
const browser = browserArg ? browserArg.split("=")[1] : "chrome";
const extension = browser === "firefox" ? "xpi" : "zip";

const outputFilename = `better-coretax-${browser}.${extension}`;
const outputPath = path.join(__dirname, outputFilename);

// Delete old file first (Windows may hold a lock)
try {
  fs.unlinkSync(outputPath);
} catch (_) {
  /* file doesn't exist or locked */
}

const output = fs.createWriteStream(outputPath);

const archive = archiver("zip", {
  zlib: { level: 6 }, // Moderate compression for maximum compatibility
});

output.on("close", function () {
  console.log(`Packaging complete: ${outputFilename}`);
  console.log(`${archive.pointer()} total bytes`);
});

archive.on("error", function (err) {
  throw err;
});

archive.pipe(output);

const distFolder = path.join("dist", browser);
if (!fs.existsSync(distFolder)) {
  console.error(`Error: Source directory ${distFolder} not found. Did you run the build first?`);
  process.exit(1);
}

// Append files from the sub-directory, putting its contents at the root of the archive
archive.directory(`${distFolder}/`, false);

archive.finalize();
