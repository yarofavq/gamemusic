export class BeatJudge {
  constructor() {
    this.timingWindowPerfect = 0.13;
    this.timingWindowGood = 0.24;
    this.flipBonus = 1.5;
  }

  /**
   * Single source of truth for jump timing judgment.
   * @param {number} kickDiff seconds to the nearest verified kick
   * @param {string} actionType 'GROUND_JUMP' | 'AIR_FLIP'
   */
  evaluate(kickDiff, actionType = 'GROUND_JUMP') {
    let rating = 'OFF-BEAT';
    let multiplier = 0.2;
    if (kickDiff <= this.timingWindowPerfect) {
      rating = 'PERFECT';
      multiplier = 2.0;
    } else if (kickDiff <= this.timingWindowGood) {
      rating = 'GOOD';
      multiplier = 1.2;
    }
    if (actionType === 'AIR_FLIP') multiplier *= this.flipBonus;
    return { rating, multiplier };
  }
}
