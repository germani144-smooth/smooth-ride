// Overall profile score: every scored drive's score weighted by its distance, so a long
// drive counts for more than a short hop. Demo drives are left out (they're not yours).

/**
 * Returns { score, distance (m), drives (counted), unscored (too short to score) }.
 * score is null until at least one real drive has a score.
 */
export function profileScore(drives) {
  let weighted = 0;
  let distance = 0;
  let counted = 0;
  let unscored = 0;
  for (const d of drives) {
    if (d.source === "demo" || d.inProgress || !d.summary) continue;
    const { score, distance: m } = d.summary;
    if (score == null || !(m > 0)) {
      unscored++;
      continue;
    }
    weighted += score * m;
    distance += m;
    counted++;
  }
  return {
    score: distance > 0 ? Math.round(weighted / distance) : null,
    distance,
    drives: counted,
    unscored,
  };
}
