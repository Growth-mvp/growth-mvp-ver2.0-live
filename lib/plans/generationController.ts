/**
 * 経営計画書の生成リクエストを、会社・戦略の切替と照合して管理する。
 *
 * - 切替（scopeChanged）で、進行中のリクエストは以後すべて無効になる。
 *   API 側で既に始まった生成や保存は止められないが、その結果は画面に反映しない。
 * - 無効になったリクエストの finish は、後から始まった生成の状態を変えない（トークンで照合）。
 * - 切替後は、新しい会社で直ちに生成を開始できる。
 */
export class GenerationController {
  private token = 0;
  private active: { key: string; token: number } | null = null;

  /** 会社・戦略・audience が変わったとき呼ぶ。進行中のリクエストは無効になる。 */
  scopeChanged(): void {
    this.token += 1;
    this.active = null;
  }

  /** 生成を開始する。既に生成中なら null を返す（二重送信の防止）。 */
  start(key: string): number | null {
    if (this.active !== null) return null;
    this.token += 1;
    this.active = { key, token: this.token };
    return this.token;
  }

  /** 応答を画面に反映してよいか。切替後や後発の操作があれば false。 */
  isCurrent(token: number): boolean {
    return token === this.token;
  }

  /** 終了処理。自分の生成が有効なときだけ状態を解除する。 */
  finish(token: number): void {
    if (this.active !== null && this.active.token === token) {
      this.active = null;
    }
  }

  /** 指定したキーの生成が進行中か（UI の表示用） */
  isGeneratingFor(key: string): boolean {
    return this.active !== null && this.active.key === key;
  }

  /** どこかで生成が進行中か */
  isBusy(): boolean {
    return this.active !== null;
  }
}
