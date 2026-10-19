/**
 * Which runs of a turn have ended, by their position in the chat's enabled list. A run that must wait for others
 * (`predecessors`) waits on `until`; every run calls `end` when it is over, whatever came of it: a failure, a stop, or not
 * starting at all, so that nothing waits for a run that will never report. Both sections of a turn share one board.
 */
export class RunBoard {
  private readonly ended: Promise<void>[] = [];
  private readonly finish: (() => void)[] = [];

  constructor(size: number) {
    for (let position = 0; position < size; position++)
      this.ended.push(
        new Promise<void>((resolve) => {
          this.finish.push(resolve);
        }),
      );
  }

  /** Marks the run at `position` as over. Calling it again does nothing. */
  end(position: number): void {
    this.finish[position]?.();
  }

  /** Resolves once every one of the runs at these positions has ended (at once for none). */
  async until(positions: readonly number[]): Promise<void> {
    await Promise.all(positions.map((position) => this.ended[position]));
  }
}
