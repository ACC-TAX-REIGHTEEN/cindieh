const fs = require("fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const micrositePath = "microsite/index.html";
const microsite = fs.readFileSync(micrositePath, "utf8");

manifest.version = pkg.version;

fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const softwareVersionPattern = /("softwareVersion"\s*:\s*")([^\"]+)(")/;
if (!softwareVersionPattern.test(microsite)) {
	throw new Error(`${micrositePath} has no SoftwareApplication softwareVersion`);
}
fs.writeFileSync(
	micrositePath,
	microsite.replace(softwareVersionPattern, `$1${pkg.version}$3`),
);

console.log(`manifest.json and ${micrositePath} synced → ${manifest.version}`);
