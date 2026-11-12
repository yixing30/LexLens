/* Self-authored demonstration entries. Every level is an estimate, never an official rating. */
(function (root) {
  'use strict';

  const LEVELS = Object.freeze({
    en: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    ja: ['N5', 'N4', 'N3', 'N2', 'N1'],
    ko: ['1', '2', '3', '4', '5', '6']
  });
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: { en: true, ja: false, ko: false },
    levels: { en: 'B1', ja: 'N3', ko: '3' },
    density: 'standard',
    englishEvidence: 'sourced',
    includeCurrentLevel: false,
    disabledSites: []
  });
  const SOURCE = 'LexLens 自编示例词表';
  const ENGLISH_SOURCE = 'ECDICT 释义；当代词频难度估计';
  const englishAuto = root.LexLensEnglishAuto || {};
  const englishLevels = root.LexLensEnglishLevels || {};
  const englishInline = root.LexLensEnglishInline || {};
  const englishLookupHeadwords = new Set(root.LexLensEnglishLookupHeadwords || []);
  const POS_LABELS = { n: '名词', v: '动词', vi: '不及物动词', vt: '及物动词', a: '形容词', adj: '形容词', adv: '副词', ad: '副词', prep: '介词', conj: '连词', pron: '代词', int: '感叹词', num: '数词', art: '冠词', abbr: '缩写' };
  const ENGLISH_POS = { '名词': 'n', '动词': 'v', '不及物动词': 'v', '及物动词': 'v', '形容词': 'a', '副词': 'adv' };
  let englishLookupData = null;
  // Manually reviewed senses for common academic and technology writing.
  // Context guards keep metaphorical or domain-specific meanings out of unrelated prose.
  const reviewedEnglish = [
    ['ceiling', ['ceiling', 'ceilings'], 'B2', '能力上限', '此处比喻能力或表现所能达到的最高水平。', '名词', '\\b(?:AI|model|user|performance|capabilit(?:y|ies))\\b', 0.88],
    ['floor', ['floor', 'floors'], 'B2', '能力下限', '此处比喻基本能力或表现的最低水平。', '名词', '\\b(?:AI|model|performance|studies)\\b', 0.88],
    ['prompt', ['prompt', 'prompts'], 'B2', '提示词', '给 AI 模型的文字指令或输入。', '名词', '\\b(?:AI|model|Claude|LLM|library)\\b', 0.84],
    ['fixed', ['fixed'], 'B2', '固定的', '事先确定、在此处不改变的。', '形容词', '\\b(?:target|criteri(?:a|on)|evaluation|quality|threshold|amount|goal)\\b', 0.78],
    ['output', ['output', 'outputs'], 'B1', '输出', '系统、模型或工作过程产生结果。', '词语', null, 0.78],
    ['vendor', ['vendor', 'vendors'], 'B1', '供应商', '提供产品或服务的一方。', '名词', null, 0.77],
    ['measured', ['measured'], 'B2', '经过测量', '通过测量或数据来判断。', '词语', null, 0.76],
    ['replication', ['replication', 'replications'], 'C1', '复现', '在研究中重复实验或任务，以检查结果是否能再次得到。', '名词', '\\b(?:study|research|experiment|task|result|paper|trial)\\b', 0.84],
    ['randomized', ['randomized'], 'C1', '随机分组的', '按随机方式分配参与者或条件的。', '形容词', '\\b(?:study|experiment|trial|participant|test)\\b', 0.84],
    ['abstract', ['abstract', 'abstracts'], 'B2', '摘要', '论文或报告开头概述研究的短文。', '名词', '\\b(?:paper|published|study|record|v[0-9])\\b', 0.78],
    ['upgrade', ['upgrade', 'upgrades', 'upgraded'], 'B1', '升级', '改进到更新或更高的版本。', '词语', null, 0.77],
    ['generative', ['generative'], 'C1', '生成式的', '能生成文字、图像等新内容的。', '形容词', '\\b(?:AI|model|system|assistant)\\b', 0.82],
    ['productivity', ['productivity'], 'B1', '生产效率', '单位时间内完成工作的效率或产出。', '名词', null, 0.78],
    ['frontier', ['frontier', 'frontiers'], 'B2', '前沿', '某领域目前最先进、最靠前的部分。', '名词', '\\b(?:AI|model|agent|technological|research)\\b', 0.82],
    ['skilled', ['skilled'], 'B2', '熟练的', '掌握相关技能、经验较丰富的。', '形容词', null, 0.76],
    ['adaptation', ['adaptation', 'adaptations'], 'B2', '调整适应', '根据环境、任务或工具变化所做的调整。', '名词', '\\b(?:prompt|AI|model|task|system)\\b', 0.76],
    ['published', ['published'], 'B1', '已发表的', '已正式发表或公开的。', '形容词', null, 0.75],
    ['sophistication', ['sophistication'], 'C1', '复杂程度', '表达、系统或方法的精细与复杂程度。', '名词', '\\b(?:prompt|response|model|system|text)\\b', 0.76],
    ['generic', ['generic'], 'B2', '通用的', '不针对某个特定对象或任务的。', '形容词', null, 0.76],
    ['novice', ['novice', 'novices'], 'B2', '新手', '刚接触某项活动、经验较少的人。', '名词', null, 0.8],
    ['empowerment', ['empowerment'], 'B2', '赋权', '给予某人能力、权限或自主行动空间。', '名词', null, 0.76],
    ['correlation', ['correlation', 'correlations'], 'C2', '相关性', '两个变量一起变化的统计关联，不直接表示因果。', '名词', null, 0.8],
    ['precise', ['precise'], 'A2', '精确的', '表达或测量足够具体、准确的。', '形容词', null, 0.78],
    ['realistic', ['realistic'], 'B1', '贴近现实的', '与现实条件或实际情况接近的。', '形容词', null, 0.76],
    ['shared', ['shared'], 'B1', '共享的', '由多个人或系统共同使用的。', '形容词', null, 0.75],
    ['mentor', ['mentor', 'mentors'], 'B2', '导师', '为经验较少者提供指导的人。', '名词', null, 0.78],
    ['steer', ['steer', 'steers', 'steered', 'steering'], 'B2', '引导', '使行动或结果朝某个方向发展。', '动词', null, 0.77],
    ['specify', ['specify', 'specifies', 'specified', 'specifying'], 'B2', '明确指定', '清楚说明具体要求、目标或条件。', '动词', null, 0.8],
    ['variance', ['variance', 'variances'], 'B2', '方差', '衡量数据或结果变化幅度的统计量。', '名词', '\\b(?:outcome|model|prompt|partition|statistic|data)\\b', 0.82],
    ['efficacy', ['efficacy'], 'B2', '效力', '某种方法或措施达到预期效果的能力。', '名词', null, 0.78],
    ['causal', ['causal'], 'B2', '因果的', '与原因和结果之间的关系有关的。', '形容词', null, 0.79],
    ['divergent', ['divergent'], 'C1', '有分歧的', '朝不同方向发展或结论不一致的。', '形容词', null, 0.77],
    ['wording', ['wording'], 'B2', '措辞', '表达某件事时选择的具体字句。', '名词', null, 0.8],
    ['synergy', ['synergy'], 'C1', '协同作用', '多个部分一起工作时产生的综合效果。', '名词', null, 0.82],
    ['unambiguous', ['unambiguous'], 'C1', '明确无歧义的', '只能按一种主要方式理解的。', '形容词', null, 0.83],
    ['clarity', ['clarity'], 'B1', '清晰度', '表达或思路容易被理解的程度。', '名词', null, 0.77],
    ['reliability', ['reliability'], 'B1', '可靠性', '结果或系统值得信赖、保持稳定的程度。', '名词', null, 0.77],
    ['threshold', ['threshold', 'thresholds'], 'B1', '阈值', '达到某个结果或分类所需的界限。', '名词', '\\b(?:quality|model|performance|level|test|score|fixed)\\b', 0.78],
    ['collaboration', ['collaboration'], 'C1', '协作', '多人共同完成工作的过程。', '名词', null, 0.76],
    ['comparable', ['comparable'], 'B1', '可比较的', '条件相近，适合放在一起比较的。', '形容词', null, 0.76],
    ['similarity', ['similarity', 'similarities'], 'B1', '相似性', '事物彼此相像的程度或特征。', '名词', null, 0.76],
    ['technological', ['technological'], 'B1', '技术的', '与技术或其发展有关的。', '形容词', null, 0.76],
    ['dynamic', ['dynamic'], 'B2', '动态的', '随时间或条件变化的。', '形容词', '\\b(?:system|model|process|environment|change|adaptation)\\b', 0.75],
    ['quantity', ['quantity', 'quantities'], 'B1', '数量', '某种事物的多少。', '名词', null, 0.76],
    ['minimal', ['minimal'], 'B1', '最低限度的', '所需或允许的数量、程度很小的。', '形容词', null, 0.76],
    ['timid', ['timid'], 'C1', '胆怯的', '缺乏勇气或信心的。', '形容词', null, 0.78]
  ];
  const entries = [
    { lang: 'en', lemma: 'run out of', forms: ['run out of', 'runs out of', 'ran out of', 'running out of'], senses: [
      { id: 'exhaust', level: 'B2', gloss: '用完', detail: '把某物用尽；此处表示不再有可用数量。', type: '词组', impact: 0.94 }
    ] },
    { lang: 'en', lemma: 'meticulous', forms: ['meticulous'], senses: [
      { id: 'careful', level: 'C2', gloss: '一丝不苟的', detail: '做事非常细致、注意每个细节。', type: '形容词', impact: 0.87 }
    ] },
    { lang: 'en', lemma: 'ubiquitous', forms: ['ubiquitous'], senses: [
      { id: 'everywhere', level: 'C1', gloss: '无处不在的', detail: '在许多地方都能见到，十分普遍。', type: '形容词', impact: 0.78 }
    ] },
    { lang: 'en', lemma: 'subtle', forms: ['subtle'], senses: [
      { id: 'nuanced', level: 'B2', gloss: '微妙的', detail: '差异或特征不明显，需要仔细观察。', type: '形容词', impact: 0.69 }
    ] },
    { lang: 'en', lemma: 'bank', forms: ['bank', 'banks'], senses: [
      { id: 'river_edge', level: 'B2', gloss: '河岸', detail: '河流旁边的土地。', type: '名词', context: '\\b(river|stream|water|shore|flood)\\b', impact: 0.82 },
      { id: 'finance', level: 'A2', gloss: '银行', detail: '提供存款等金融服务的机构。', type: '名词', context: '\\b(money|loan|account|deposit|finance)\\b', impact: 0.65 }
    ] },
    { lang: 'en', lemma: 'draft', forms: ['draft', 'drafts'], senses: [
      { id: 'version', level: 'B2', gloss: '草稿', detail: '尚未完成的文字或设计版本。', type: '名词', context: '\\b(write|article|document|essay|report|edit|version)\\b', impact: 0.75 },
      { id: 'air', level: 'C1', gloss: '穿堂风', detail: '从门窗等处进入的冷空气。', type: '名词', context: '\\b(cold|window|door|air|wind)\\b', impact: 0.84 }
    ] },
    { lang: 'en', lemma: 'nevertheless', forms: ['nevertheless'], senses: [
      { id: 'contrast', level: 'B1', gloss: '尽管如此', detail: '用于说明前述情况成立，但后面的事实仍然发生。', type: '副词', impact: 0.71 }
    ] },
    ...reviewedEnglish.map(([lemma, forms, level, gloss, detail, type, context, impact]) => ({
      lang: 'en', lemma, forms,
      senses: [{ id: 'reviewed', level, gloss, detail, type, context, impact }]
    })),
    { lang: 'ja', lemma: '余儀なくされる', forms: ['余儀なくされる', '余儀なくされた', '余儀なくされ'], senses: [
      { id: 'forced', level: 'N1', gloss: '被迫', detail: '因形势所迫而不得不做某事。', type: '表达', impact: 0.94 }
    ] },
    { lang: 'ja', lemma: '複雑', forms: ['複雑', '複雑な', '複雑で'], senses: [
      { id: 'complex', level: 'N2', gloss: '复杂', detail: '由许多部分或因素组成，不容易理解。', type: '形容动词', impact: 0.75 }
    ] },
    { lang: 'ja', lemma: '顕著', forms: ['顕著', '顕著な', '顕著に'], senses: [
      { id: 'marked', level: 'N1', gloss: '显著', detail: '程度明显，容易观察到。', type: '形容动词', impact: 0.84 }
    ] },
    { lang: 'ja', lemma: '見積もる', forms: ['見積もる', '見積もった', '見積もり'], senses: [
      { id: 'estimate', level: 'N2', gloss: '估算', detail: '对费用、数量或时间作出大致计算。', type: '动词', impact: 0.74 }
    ] },
    { lang: 'ko', lemma: '해결하다', forms: ['해결하다', '해결했다', '해결하는', '해결해'], senses: [
      { id: 'solve', level: '4', gloss: '解决', detail: '处理问题并找到办法。', type: '动词', impact: 0.75 }
    ] },
    { lang: 'ko', lemma: '불가피하다', forms: ['불가피하다', '불가피한', '불가피했다'], senses: [
      { id: 'unavoidable', level: '5', gloss: '不可避免', detail: '在当前条件下无法回避。', type: '形容词', impact: 0.88 }
    ] },
    { lang: 'ko', lemma: '현저하다', forms: ['현저하다', '현저한', '현저하게'], senses: [
      { id: 'marked', level: '6', gloss: '显著', detail: '差异或程度十分明显。', type: '形容词', impact: 0.82 }
    ] }
  ];

  function normalizeSettings(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const enabled = {};
    const levels = {};
    for (const lang of Object.keys(LEVELS)) {
      enabled[lang] = lang === 'en' && (typeof raw.enabled?.[lang] === 'boolean' ? raw.enabled[lang] : DEFAULT_SETTINGS.enabled[lang]);
      levels[lang] = LEVELS[lang].includes(raw.levels?.[lang]) ? raw.levels[lang] : DEFAULT_SETTINGS.levels[lang];
    }
    return {
      enabled,
      levels,
      density: ['light', 'standard', 'all'].includes(raw.density) ? raw.density : DEFAULT_SETTINGS.density,
      englishEvidence: ['sourced', 'estimated'].includes(raw.englishEvidence) ? raw.englishEvidence : DEFAULT_SETTINGS.englishEvidence,
      includeCurrentLevel: typeof raw.includeCurrentLevel === 'boolean' ? raw.includeCurrentLevel : DEFAULT_SETTINGS.includeCurrentLevel,
      disabledSites: Array.isArray(raw.disabledSites) ? raw.disabledSites.filter(x => typeof x === 'string') : []
    };
  }

  function sentenceAt(text, start, end) {
    const breaks = /[.!?。！？\n\0]/u;
    let left = start;
    let right = end;
    while (left > 0 && !breaks.test(text[left - 1])) left--;
    while (right < text.length && !breaks.test(text[right])) right++;
    return text.slice(left, right);
  }

  const REJECT_ENGLISH_SENSE = {
    ceiling: /\b(?:paint(?:ed|ing)?|plaster|roof|room|fan|wall|look(?:ed|ing)? up|scan(?:s|ned|ning)?)\b/iu,
    floor: /\b(?:mop(?:ped|ping)?|clean(?:ed|ing|s)?|tile(?:d|s)?|carpet|room|wood|robot)\b/iu,
    prompt: /\bprompt\s+(?:response|reply|action|payment|service|attention|treatment|arrival)\b/iu,
    abstract: /\babstract\s+(?:idea|concept|painting|art|sculpture|thought|reasoning)\b/iu,
    replication: /\b(?:DNA|RNA|virus|viral|cellular|chromosome)\b/iu
  };

  function senseFor(entry, sentence) {
    if (entry.lang === 'en' && REJECT_ENGLISH_SENSE[entry.lemma]?.test(sentence)) return null;
    const matches = entry.senses.filter(s => !s.context || new RegExp(s.context, 'iu').test(sentence));
    // Multiple plausible meanings must be left unmarked until the user asks.
    return matches.length === 1 ? matches[0] : null;
  }

  function levelIndex(lang, level) { return LEVELS[lang].indexOf(level); }

  function estimatedEnglishLevel(rank) {
    if (rank <= 1500) return 'A1';
    if (rank <= 3500) return 'A2';
    if (rank <= 6000) return 'B1';
    if (rank <= 12000) return 'B2';
    if (rank <= 22000) return 'C1';
    return 'C2';
  }

  function englishProfile(word, type) {
    const part = ENGLISH_POS[type] || ({ vi: 'v', vt: 'v', adj: 'a' }[type] || type);
    if (!['n', 'v', 'a', 'adv'].includes(part)) return null;
    const matches = (englishLevels[word] || []).filter(([pos]) => pos === part);
    if (!matches.length || new Set(matches.map(([, level]) => level)).size !== 1) return null;
    return { level: matches[0][1], levelSource: `${matches[0][2]}（词形与词性级别）` };
  }

  function highlightProfile(word) {
    const evidence = englishLevels[word];
    if (!englishLookupHeadwords.has(word) || !englishInline[word] || !evidence?.length) return null;
    const lowest = evidence.reduce((a, b) => levelIndex('en', a[1]) <= levelIndex('en', b[1]) ? a : b);
    const mixed = new Set(evidence.map(([, level]) => level)).size > 1;
    return { level: lowest[1], mixed, parts: [...new Set(evidence.map(([pos]) => pos))],
      levelSource: `${[...new Set(evidence.map(([, , source]) => source))].join('、')}（${mixed ? '各词性最低等级；' : ''}词形与词性级别；句义未判断）` };
  }

  function profileForm(word) {
    const exact = highlightProfile(word);
    if (exact) return { lemma: word, ...exact };
    if (englishLevels[word] || word.length < 5) return null;
    const bases = [];
    if (word.endsWith('ies')) bases.push(word.slice(0, -3) + 'y');
    if (word.endsWith('es')) bases.push(word.slice(0, -2));
    if (word.endsWith('s')) bases.push(word.slice(0, -1));
    if (word.endsWith('ing')) bases.push(word.slice(0, -3), word.slice(0, -3) + 'e');
    if (word.endsWith('ied')) bases.push(word.slice(0, -3) + 'y');
    if (word.endsWith('ed')) bases.push(word.slice(0, -2), word.slice(0, -1));
    const matches = [...new Set(bases)].filter(base => base.length >= 3).map(base => ({ lemma: base, profile: highlightProfile(base) })).filter(item => item.profile);
    if (matches.length !== 1) return null;
    return { lemma: matches[0].lemma, ...matches[0].profile, levelSource: `${matches[0].profile.levelSource}；常见词形还原` };
  }

  function inlineGloss(profile, word, text, start, end) {
    const entry = englishInline[profile.lemma];
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    const before = text.slice(Math.max(0, start - 28), start).toLowerCase();
    const after = text.slice(end, end + 24).toLowerCase();
    let part = profile.parts.length === 1 ? profile.parts[0] : '';
    if (!part && word !== profile.lemma && /(?:ed|ing|ied)$/u.test(word) && entry.v) part = 'v';
    if (!part && /(?:^|\s)(?:to|can|could|will|would|shall|should|may|might|must|do|does|did)\s+$/u.test(before) && entry.v) part = 'v';
    if (!part && /(?:^|\s)(?:a|an|the|this|that|these|those|my|your|our|their|its|his|her)\s+$/u.test(before) && entry.n) part = 'n';
    if (!part && /^\s+(?:is|are|was|were|can|could|will|would|may|might|must)\b/u.test(after) && entry.n) part = 'n';
    return entry[part] || entry._ || Object.values(entry)[0] || '';
  }

  function reviewedGrade(entry, sense, settings) {
    const profile = englishProfile(entry.lemma, sense.type);
    if (settings.englishEvidence === 'sourced') return profile?.level === sense.level ? profile : null;
    if (sense.context && profile && levelIndex('en', sense.level) > levelIndex('en', profile.level)) {
      return { level: sense.level, levelSource: '人工语境难度估计（无可靠逐义定级）' };
    }
    return profile || { level: sense.level, levelSource: '人工难度估计（无词表等级）' };
  }

  function shouldShow(entry, sense, settings, records) {
    if (!settings.enabled[entry.lang]) return false;
    const record = records?.[`${entry.lang}:${entry.lemma}:${sense.id}`];
    if (record === 'known') return false;
    if (record === 'unknown') return true;
    if (!sense.level || !LEVELS[entry.lang].includes(sense.level)) return false;
    const gap = levelIndex(entry.lang, sense.level) - levelIndex(entry.lang, settings.levels[entry.lang]);
    if (gap < 0 || (gap === 0 && !settings.includeCurrentLevel)) return false;
    const minimum = { light: 0.8, standard: 0.65, all: 0.5 }[settings.density];
    return sense.impact >= minimum;
  }

  function candidates(text, rawSettings, records = {}) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const settings = normalizeSettings(rawSettings);
    const found = [];
    for (const entry of entries) {
      if (!settings.enabled[entry.lang]) continue;
      for (const form of entry.forms) {
        const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const pattern = entry.lang === 'en' ? `(?<![\\p{L}])${escaped}(?![\\p{L}])` : escaped;
        const regex = new RegExp(pattern, entry.lang === 'en' ? 'giu' : 'gu');
        for (const match of text.matchAll(regex)) {
          const start = match.index;
          const end = start + match[0].length;
          const sense = senseFor(entry, sentenceAt(text, start, end));
          if (!sense) continue;
          const grade = entry.lang === 'en' ? reviewedGrade(entry, sense, settings) : null;
          const scored = entry.lang === 'en' ? { ...sense, level: grade?.level || null } : sense;
          if (!shouldShow(entry, scored, settings, records)) continue;
          found.push({ start, end, text: match[0], lang: entry.lang, lemma: entry.lemma,
            senseId: sense.id, gloss: sense.gloss, detail: sense.detail, type: sense.type,
            level: scored.level || '未分级',
            levelSource: entry.lang === 'en' ? grade?.levelSource || '未分级；个人标记' : 'LexLens 人工估计',
            source: SOURCE, estimated: true, impact: sense.impact });
        }
      }
    }
    if (settings.enabled.en) {
      for (const match of text.matchAll(/(?<![\p{L}])([A-Za-z]{3,24})(?![\p{L}])/gu)) {
        const word = match[1].toLowerCase();
        const profile = profileForm(word);
        if (!profile) continue;
        const gap = levelIndex('en', profile.level) - levelIndex('en', settings.levels.en);
        const record = records[`en:${profile.lemma}:profile_lookup`];
        if (record === 'known' || (record !== 'unknown' && (gap < 0 || (gap === 0 && (!settings.includeCurrentLevel || profile.mixed)) || (settings.density === 'light' && gap === 1)))) continue;
        const gloss = inlineGloss(profile, word, text, match.index, match.index + match[1].length);
        if (!gloss) continue;
        found.push({ kind: 'dictionary', start: match.index, end: match.index + match[1].length,
          text: match[1], lang: 'en', lemma: profile.lemma, senseId: 'profile_lookup',
          gloss, level: profile.level, levelSource: profile.levelSource,
          source: 'CEFR-J / Octanove 词形等级；ECDICT 常见词典义', estimated: false, impact: 0.6 });
      }
    }
    // Optional frequency estimates also show a short dictionary meaning.
    if (settings.enabled.en && settings.englishEvidence === 'estimated') {
      for (const match of text.matchAll(/(?<![\p{L}])([a-z]{3,24})(?![\p{L}])/gu)) {
        const word = match[1];
        if (!Object.hasOwn(englishAuto, word)) continue;
        const [gloss, rank, type] = englishAuto[word];
        const profile = englishProfile(word, type);
        const sense = { id: 'frequency_single_gloss', level: profile?.level || estimatedEnglishLevel(rank),
          impact: Math.min(0.98, 0.58 + rank / 50000 * 0.4) };
        const entry = { lang: 'en', lemma: word };
        if (!shouldShow(entry, sense, settings, records)) continue;
        found.push({ kind: 'dictionary', start: match.index, end: match.index + word.length, text: word,
          lang: 'en', lemma: word, senseId: sense.id,
          gloss, type: POS_LABELS[type] || '词语', level: sense.level,
          levelSource: profile?.levelSource || 'ECDICT 词频粗略估计（非 CEFR 分级）', source: ENGLISH_SOURCE,
          estimated: true, impact: sense.impact });
      }
    }
    // A reader can explicitly mark an unannotated dictionary word as unfamiliar.
    // Its local short meaning is saved with the record so new pages need no dictionary download.
    if (settings.enabled.en) {
      for (const match of text.matchAll(/(?<![\p{L}])([A-Za-z]{3,24})(?![\p{L}])/gu)) {
        const word = match[1].toLowerCase();
        const record = records[`en:${word}:manual_unknown`];
        if (!record || typeof record !== 'object' || record.state !== 'unknown' || typeof record.gloss !== 'string' || !record.gloss.trim()) continue;
        found.push({ kind: 'dictionary', start: match.index, end: match.index + match[1].length,
          text: match[1], lang: 'en', lemma: word, senseId: 'manual_unknown', gloss: record.gloss,
          type: record.type || '词语', level: record.level || '个人记录',
          levelSource: '个人标记：仍不认识', source: '本地词典；个人记录', estimated: false, impact: 1 });
      }
    }
    // A longer phrase or inflected form wins over overlapping shorter matches.
    found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || Number(a.kind === 'dictionary') - Number(b.kind === 'dictionary') || a.start - b.start);
    const chosen = [];
    for (const item of found) {
      if (!chosen.some(other => item.start < other.end && item.end > other.start)) chosen.push(item);
    }
    return chosen.sort((a, b) => a.start - b.start);
  }

  function lookup(query) {
    if (typeof query !== 'string') return [];
    const normalized = query.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 80) return [];
    const results = [];
    let contextual = false;
    for (const entry of entries) {
      const matches = entry.forms.some(form => entry.lang === 'en'
        ? form.toLocaleLowerCase('en') === normalized.toLocaleLowerCase('en')
        : form === normalized);
      if (!matches) continue;
      if (entry.lang === 'en' && (entry.senses.length > 1 || entry.senses.some(sense => sense.context))) contextual = true;
      for (const sense of entry.senses) {
        const profile = entry.lang === 'en' ? englishProfile(entry.lemma, sense.type) : null;
        const conflictingSense = !!sense.context && !!profile && sense.level !== profile.level;
        results.push({ text: normalized, lang: entry.lang, lemma: entry.lemma,
          senseId: sense.id, gloss: sense.gloss, detail: sense.detail, type: sense.type,
          level: conflictingSense ? '未分级' : profile?.level || sense.level,
          levelSource: conflictingSense
            ? `${profile.levelSource} 为 ${profile.level}；该词义仅有人工难度估计 ${sense.level}`
            : profile?.levelSource || '人工估计；主动查询未消歧',
          source: SOURCE, estimated: true });
      }
    }
    if ((results.length && !contextual) || !englishLookupData) return results;
    const data = englishLookupData[normalized.toLocaleLowerCase('en')];
    if (!data) return results;
    const [translation, rank] = data;
    const profile = highlightProfile(normalized.toLocaleLowerCase('en'));
    results.push({ text: normalized, lang: 'en', lemma: normalized.toLocaleLowerCase('en'),
      senseId: 'dictionary_entry', gloss: translation.split('\n')[0].slice(0, 80),
      detail: translation, type: '词典条目（未按当前句义消歧）',
      level: profile?.level || estimatedEnglishLevel(rank), source: ENGLISH_SOURCE,
      levelSource: profile?.levelSource || 'ECDICT 词频粗略估计（非 CEFR 分级）',
      estimated: true, recordable: false });
    return results;
  }

  function setEnglishLookupData(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) englishLookupData = value;
  }

  const api = Object.freeze({ LEVELS, DEFAULT_SETTINGS, normalizeSettings, candidates, lookup, setEnglishLookupData, estimatedEnglishLevel });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LexLensCore = api;
})(globalThis);
