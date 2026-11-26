// Settings: About. How the app works and how to get a good score, in the current language.
// Each section folds open (details/summary). Paragraphs are separated by a blank line; a
// paragraph whose lines all start with "- " is a list. textContent only.
import { t } from "./core/i18n.js";

function paragraph(text) {
  const lines = text.split("\n");
  if (lines.every((line) => line.startsWith("- "))) {
    const list = document.createElement("ul");
    for (const line of lines) {
      const item = document.createElement("li");
      item.textContent = line.slice(2);
      list.append(item);
    }
    return list;
  }
  const node = document.createElement("p");
  node.textContent = text;
  return node;
}

export function renderAbout(container) {
  const sections = t("about.sections");
  container.replaceChildren(
    ...sections.map(({ title, body }) => {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = title;
      details.append(summary, ...body.split("\n\n").map(paragraph));
      return details;
    }),
  );
}
