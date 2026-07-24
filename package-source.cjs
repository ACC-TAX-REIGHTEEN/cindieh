const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const outputFilename = "better-coretax-source.zip";
const output = fs.createWriteStream(path.join(__dirname, outputFilename));
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

// Items to exclude
const exclude = [
	"node_modules",
	"dist",
	".git",
	"better-coretax-chrome.zip",
	"better-coretax-firefox.xpi",
	"better-coretax-source.zip",
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
