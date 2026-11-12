(function (root) {
  'use strict';

  // Each note is tied to an exact span in the selected sentence. These rules
  // identify reading cues; they do not claim to be a full syntactic parse.
  const RULES = [
    { name: '成对并列', regex: /\bnot only\b.{1,110}?\bbut also\b/i,
      explanation: 'not only … but also 把两个重点并列，并强调后者。',
      reading: '分别找出两端接续的内容，再合起来读。' },
    { name: '选择关系', regex: /\beither\b.{1,90}?\bor\b/i,
      explanation: 'either … or 表示在两个可能项之间选择。',
      reading: '找出 or 两侧对应的成分。' },
    { name: '让步关系', regex: /\b(?:although|even though|though)\b/i,
      explanation: '这个连接词引入让步：前一情况成立，后面的结果仍然发生。',
      reading: '先读让步部分，再看主句出现了什么反常结果。' },
    { name: '条件关系', regex: /\b(?:if|unless)\b/i,
      explanation: 'if 引出条件；unless 通常表示“除非”。',
      reading: '把条件与条件成立时的结果分开读。' },
    { name: '原因关系', regex: /\bbecause\b/i,
      explanation: 'because 引出原因，解释另一部分为什么成立。',
      reading: '先确认结果，再回头看原因。' },
    { name: '时间或对照', regex: /\b(?:when|while)\b/i,
      explanation: 'when 常引出时间或条件；while 可表示同时发生，也可表示对照。',
      reading: '结合两侧内容判断是时间关系还是对照关系。' },
    { name: '名词性从句线索', regex: /\bwhat\b/i, afterStart: true,
      explanation: 'what 后的一整段可充当句中的一个内容单位，也可能是间接疑问。',
      reading: '先把 what 后的部分作为整体，再看它在主句里充当什么。' },
    { name: '关系从句线索', regex: /\b(?:who|whom|whose|which)\b/i, afterStart: true,
      explanation: '这些词可能引出对前面名词的补充说明；也可能用于间接疑问。',
      reading: '先寻找它前面是否有被修饰的名词。' },
    { name: '地点或情境从句', regex: /\bwhere\b/i, afterStart: true,
      explanation: 'where 后的部分常交代地点，也可引申为某种情境。',
      reading: '先读主句，再把 where 后的信息补进去。' },
    { name: '完成时线索', regex: /\b(?:have|has|had)\s+(?:(?:already|just|never|recently)\s+)?(?:been|done|made|seen|given|found|written|taken|known|shown|held|built|gone|come|become|\w+ed)\b/i,
      explanation: 'have / has / had 加过去分词，通常把动作与某个参照时间联系起来。',
      reading: '留意前后文的时间线，再确定是现在完成还是过去完成。' },
    { name: '被动或状态线索', regex: /\b(?:am|is|are|was|were|be|been|being)\s+(?:(?:not|already)\s+)?(?:\w+ed|done|made|seen|given|found|written|taken|known|shown|held|built)\b/i,
      explanation: 'be 加过去分词可能表示被动，也可能描述状态，单靠形式不能完全区分。',
      reading: '看句子是否强调动作承受者，以及是否出现 by 引出的执行者。' },
    { name: '情态动词', regex: /\b(?:can|could|may|might|must|should|would|will)\s+(?:not\s+)?(?:(?:still|also|often|really|probably|possibly|never|always|just|even|only)\s+){0,2}(?!still\b|also\b|often\b|really\b|probably\b|possibly\b|never\b|always\b|just\b|even\b|only\b)[a-z]+\b/i,
      explanation: '情态动词与后面的动词一起表达可能、能力、义务或说话者态度。',
      reading: '先读核心动作，再按具体情态词补上语气。' },
    { name: '比较结构', regex: /\b(?:more|less|better|worse)\b.{1,75}?\bthan\b/i,
      explanation: '比较结构把两个对象放在同一维度上比较。',
      reading: '找出比较的对象、维度和结果。' },
    { name: '同级比较', regex: /\bas\b.{1,70}?\bas\b/i,
      explanation: 'as … as 常用于表示在某一方面达到相同程度。',
      reading: '重点看两个 as 之间比较的性质或数量。' },
    { name: '转折或并列', regex: /\b(?:but|and|or)\b/i,
      explanation: '连接词把两侧成分连接起来；but 偏转折，and 偏补充，or 偏选择。',
      reading: '先确认它连接的是词组、动作，还是两个分句。' },
    { name: '分号连接', regex: /;/,
      explanation: '分号通常连接关系密切、但各自较完整的两部分。',
      reading: '先在分号处断开，分别读完两侧，再判断它们的关系。' }
  ];

  function splitSentences(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    if (typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      return [...segmenter.segment(normalized)].map(part => part.segment.trim()).filter(Boolean);
    }
    return normalized.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(part => part.trim()).filter(Boolean) || [normalized];
  }

  function outline(sentence) {
    const match = sentence.match(/^(Although|Even though|Though|If|Unless|When|While|Because)\b([^,]{2,180}),\s*(.+)$/i);
    if (!match) return null;
    const word = match[1].toLowerCase();
    const relation = /^(although|even though|though)$/.test(word) ? '让步从句'
      : /^(if|unless)$/.test(word) ? '条件从句'
        : word === 'because' ? '原因从句' : '时间或对照从句';
    return [{ role: relation, text: `${match[1]}${match[2]}` }, { role: '后续主句', text: match[3] }];
  }

  function modalExplanation(evidence) {
    const modal = evidence.match(/^[a-z]+/i)?.[0].toLowerCase();
    const meanings = {
      can: '能力或可能', could: '过去的能力、较委婉的可能', may: '可能或许可',
      might: '较不确定的可能', must: '必要或推断', should: '建议或预期',
      would: '假设、意愿或过去的习惯', will: '意愿、预测或将来'
    };
    return `${modal} 与后面的动词一起表达${meanings[modal] || '说话者态度'}；具体含义需看上下文。`;
  }

  function analyzeSentence(sentence) {
    const findings = [];
    for (const rule of RULES) {
      const match = rule.regex.exec(sentence);
      if (!match || (rule.afterStart && match.index === 0)) continue;
      findings.push({
        name: rule.name,
        evidence: match[0],
        explanation: rule.name === '情态动词' ? modalExplanation(match[0]) : rule.explanation,
        reading: rule.reading
      });
      if (findings.length === 5) break;
    }
    return { text: sentence, outline: outline(sentence), findings };
  }

  function analyze(text) { return splitSentences(text).map(analyzeSentence); }

  const api = Object.freeze({ analyze, splitSentences });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LexLensGrammar = api;
})(globalThis);
