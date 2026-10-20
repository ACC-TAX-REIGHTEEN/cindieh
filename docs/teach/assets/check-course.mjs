// Course consistency checker for the Cindieh ADR course.
//
// Verifies every lesson and reference page:
//   1. every relative href resolves to a file that exists
//   2. every quiz has exactly one correct option, and all options of a
//      question have the same word count
//   3. every class used in the HTML exists in assets/course.css
//   4. quiz ids are unique across the course, and match their score box
//
// Usage: node docs/teach/assets/check-course.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const lessonsDir = join(root, "lessons");
const referenceDir = join(root, "reference");
const css = readFileSync(join(here, "course.css"), "utf8");

const cssClasses = new Set(
  [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
);

const pages = [];
for (const dir of [lessonsDir, referenceDir]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".html")) pages.push(join(dir, name));
  }
}

const problems = [];
const seenQuizIds = new Map();
let quizCount = 0;

const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;

for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const rel = file.slice(root.length + 1).replace(/\\/g, "/");

  // 1. links
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = resolve(dirname(file), href.split("#")[0]);
    if (!existsSync(target)) {
      problems.push(`${rel}: tautan mati -> ${href}`);
    }
  }

  // 2. stylesheet + script
  if (!/href="\.\.\/assets\/course\.css"/.test(html) && !/href="assets\/course\.css"/.test(html)) {
    problems.push(`${rel}: tidak menautkan assets/course.css`);
  }

  // 3. css classes
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      if (!cssClasses.has(cls)) {
        problems.push(`${rel}: kelas CSS tidak dikenal -> .${cls}`);
      }
    }
  }

  // 4. quizzes
  const quizBlocks = html.split(/<div class="quiz"/).slice(1);
  for (const block of quizBlocks) {
    const idMatch = block.match(/data-quiz="([^"]+)"/);
    if (!idMatch) {
      problems.push(`${rel}: blok kuis tanpa data-quiz`);
      continue;
    }
    const id = idMatch[1];
    quizCount += 1;
    if (seenQuizIds.has(id)) {
      problems.push(`${rel}: data-quiz duplikat -> ${id} (juga di ${seenQuizIds.get(id)})`);
    }
    seenQuizIds.set(id, rel);

    const options = [...block.matchAll(/<button class="opt"[^>]*>([\s\S]*?)<\/button>/g)];
    const corrects = [...block.matchAll(/data-correct/g)].length;
    if (corrects !== 1) {
      problems.push(`${rel}/${id}: jumlah opsi benar = ${corrects} (harus 1)`);
    }
    const whys = [...block.matchAll(/data-why="/g)].length;
    if (whys !== options.length) {
      problems.push(`${rel}/${id}: ${whys} data-why untuk ${options.length} opsi`);
    }
    const counts = options.map((o) => words(o[1].replace(/<[^>]+>/g, "")));
    if (new Set(counts).size > 1) {
      problems.push(`${rel}/${id}: jumlah kata opsi tidak sama -> ${counts.join(", ")}`);
    }
  }

  // 5. score box matches the quizzes in the page
  const prefixes = new Set(
    [...html.matchAll(/data-quiz="([a-z0-9]+)-q/g)].map((m) => m[1])
  );
  for (const m of html.matchAll(/data-score-for="([^"]+)"/g)) {
    if (!prefixes.has(m[1])) {
      problems.push(`${rel}: data-score-for "${m[1]}" tidak punya kuis yang cocok`);
    }
  }

  // 6. tag balance for the containers we care about
  for (const tag of ["div", "section", "aside", "ul", "li", "table", "p", "h2", "button"]) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (open !== close) {
      problems.push(`${rel}: tag <${tag}> buka ${open} vs tutup ${close}`);
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} masalah:\n`);
  for (const p of problems) console.error("  - " + p);
  process.exitCode = 1;
} else {
  console.log(
    `OK — ${pages.length} halaman, ${quizCount} soal kuis, semua tautan resolve, semua opsi sama panjang.`
  );
}
