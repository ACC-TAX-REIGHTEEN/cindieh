const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const outputFilename = "cindieh-source.zip";

// Ensure dist directory exists
const distDir = path.join(__dirname, "dist");
if (!fs.existsSync(distDir)) {
	fs.mkdirSync(distDir, { recursive: true });
}

const output = fs.createWriteStream(path.join(__dirname, "dist", outputFilename));
const archive = archiver("zip", {
	zlib: { level: 9 }, // Sets the compression level.
});

output.on("close", function () {
	console.log(`Source code packaged: ${outputFilename} (${archive.pointer()} total bytes)`);
	console.log("This ZIP file contains the original source code required for Mozilla submission.");
});

archive.on("error", function (err) {
	throw err;
});

archive.pipe(output);

// Files and directories to include (everything by default)
const items = fs.readdirSync(__dirname);

const exclude = [
	"node_modules",
	"dist",
	".git",
	"cindieh-chrome.zip",
	"cindieh-firefox.xpi",
	"cindieh-source.zip",
	".antigravityignore",
];

items.forEach((item) => {
	if (exclude.includes(item)) return;

	const fullPath = path.join(__dirname, item);
	if (fs.lstatSync(fullPath).isDirectory()) {
		archive.directory(fullPath, item);
	} else {
		archive.file(fullPath, { name: item });
	}
});

archive.finalize();
