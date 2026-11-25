import type { ExternalInfoStatus } from './block';

export type WebSearchTurnState = {
  enabled: boolean;
  status: ExternalInfoStatus | null;
};

/** 検索の有効・無効と、この回答での検索の結果を、AIが実際の状態に基づいて説明できるように渡す */
export function buildWebSearchStatusBlock(turn: WebSearchTurnState): string {
  if (!turn.enabled) {
    return [
      '【外部WEB検索の状態】',
      '外部WEB検索の機能は、現在オフになっています。この回答では検索していません（機能無効）。',
      '検索できないことを「接続していない」と断定せず、「この機能は現在オフのため検索していない」と説明してください。',
      '社内の登録データの範囲で回答し、最新の市場・競合・規制などの情報は確認できていないと明示してください。',
    ].join('\n');
  }

  const lines = [
    '【外部WEB検索の状態】',
    '外部WEB検索の機能は有効です。市場・競合・規制などの外部情報が必要な質問や、「WEB検索して」などの指示があったときに、公開情報を検索して回答に使えます。「外部WEBに接続していない」とは答えないでください。',
  ];
  if (turn.status === null) {
    lines.push(
      'この質問では外部WEB検索を実行していません（外部情報を必要としない質問と判断）。最新の外部情報が必要な場合は、「WEB検索して」と指示してもらえば検索できると案内してください。'
    );
  } else if (turn.status === 'completed') {
    lines.push('この回答では外部WEB検索を実行し、その結果を下の【外部情報（公開情報の検索結果）】として渡しています。');
  } else {
    lines.push(
      'この回答では外部WEB検索を試みましたが、外部情報を得られませんでした。理由は下の【外部情報】に書かれています。その理由に沿って、確認できなかったことを回答の中で説明してください。'
    );
  }
  return lines.join('\n');
}
