/**
 * The constructed sample has a clock of its own. Its commits run to 4 November 2026, and a merged commit is read as "kept" once it is a week old, so which sessions count as
 * kept depends on the instant landing is judged at. Read at the real time of day, the same sample gave different landing figures from one day to the next, and the model
 * replies recorded against it (benchmark arms, Ask) stopped matching the questions put to them. Wherever the sample is read, landing is judged at this instant.
 *
 * The instant lies in the interval in which every recording was made: no merged commit of the sample crosses its seven-day mark between 23 October 21:51 and 25 October 15:42 UTC.
 */
export const SAMPLE_NOW_MS = Date.UTC(2026, 9, 24, 0, 0, 0);
