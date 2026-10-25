/**
 * The smallest number of held-out sessions the proposed policy must have paused before the record recommends adopting
 * it. Fewer than this and the held-out period cannot tell the policy from chance, so the established policy stays.
 */
export const MIN_HELD_OUT_PAUSES = 3;

/**
 * Why a proposal would not be recommended, from the three facts the recommendation rests on. One function, so that the record and the flip check (what single change
 * to those facts would turn the recommendation over) cannot disagree about what the rule is.
 */
export function adoptionFailures(f: { narrows: boolean; landedBlocked: number; landedTotal: number; paused: number }): string[] {
  const failures: string[] = [];
  if (!f.narrows) failures.push("the proposal widens the policy in force");
  if (f.landedBlocked > 0) failures.push(`it would have paused ${f.landedBlocked} of ${f.landedTotal} sessions whose work landed in the held-out period`);
  if (f.paused < MIN_HELD_OUT_PAUSES) failures.push(`it paused only ${f.paused} held-out session(s), fewer than the ${MIN_HELD_OUT_PAUSES} needed to tell it from chance`);
  return failures;
}
