// serverless style: Lambda shaped handler, no state, everything arrives in the event
exports.handler = async (event) => {
  const text = event.text || '';
  return {
    statusCode: 200,
    body: JSON.stringify({
      chars: text.length,
      words: (text.match(/\S+/g) || []).length,
      lines: text ? text.split('\n').length : 0,
    }),
  };
};
