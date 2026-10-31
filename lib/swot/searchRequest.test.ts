import OpenAI from 'openai';

/* HTTP 層だけを差し替え、送信される JSON を検査する（実際の通信は行わない） */
describe('検索リクエストの送信内容（SDK の直列化の確認）', () => {
  it('include と web_search を送り、検索フェーズでは text.format を送らない', async () => {
    let sent: any = null;
    const fakeFetch = async (_url: unknown, init: { body?: unknown }) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: 'resp_test', object: 'response', status: 'completed', output: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new OpenAI({ apiKey: 'test-key', fetch: fakeFetch as any, maxRetries: 0 });

    await client.responses.create({
      model: 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      max_output_tokens: 2500,
      instructions: 'test',
      input: 'test',
      tools: [{ type: 'web_search' }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'] as unknown as never[],
      store: false,
    });

    expect(sent.include).toEqual(['web_search_call.action.sources']);
    expect(sent.tools).toEqual([{ type: 'web_search' }]);
    expect(sent.tool_choice).toBe('required');
    expect(sent.text).toBeUndefined();
    expect(sent.store).toBe(false);
  });
});
