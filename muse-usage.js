// Muse 额度小组件 for Egern
// generic 类型脚本，放到 Egern -> 工具 -> 脚本，名称 muse-usage，类型 generic，本地文件 muse-usage.js
// 环境变量 MUSE_USAGE_URL：指向 muse-usage.json 的公开直链，例如 GitHub Raw URL
//   https://raw.githubusercontent.com/1437843430/muse-usage/main/muse-usage.json
// 数据格式见同目录 muse-usage.json
// 逻辑：每次刷新先拉取远程 JSON，成功就写入缓存；拉不到就读缓存显示，并标注“缓存”；连缓存都没有才显示“暂无数据”
// 颜色：剩余额度 >=25% 绿色，<25% 黄色，<10% 红色；额外 Token 池同样规则
// 布局（参考用户发的图）：周额度一组（剩 X% + 进度条 + 重置时间 + 免费档·已用 Y%）；
// 额外 Token 池一组（剩 Z% + 进度条 + 周额度用完后自动接管 + 已用 A%·还剩约 31B tokens）。
// 中号只放这两组（6 行），大号再加标题 Muse用量 + 更新时间、底部 iOS 决定刷新间隔，非实时；
// 中号放 8 行会溢出，顶部标题没了、底部一行被切一半。
// 刷新：返回的 widget.refreshAfter 设为 3 小时后，iOS 也会在此时间后刷新

export default async function (ctx) {
  const DATA_URL = (ctx.env && ctx.env.MUSE_USAGE_URL) || '';
  const CACHE_KEY = 'muse-usage-cache';
  const REFRESH_MS = 3 * 60 * 60 * 1000;

  const refreshAfter = new Date(Date.now() + REFRESH_MS).toISOString();

  function colorFor(remaining) {
    if (remaining < 10) return '#FF3B30';
    if (remaining < 25) return '#FFCC00';
    return '#34C759';
  }

  function barSvg(remaining, color, w) {
    const width = w || 280;
    const h = 10;
    const fillW = Math.max(0, Math.min(width, Math.round((width * remaining) / 100)));
    const c = color.replace('#', '%23');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + width + " " + h + "'><rect x='0' y='0' width='" + width + "' height='" + h + "' rx='5' fill='%23333338'/><rect x='0' y='0' width='" + fillW + "' height='" + h + "' rx='5' fill='" + c + "'/></svg>";
    return 'data:image/svg+xml,' + svg;
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return iso || '';
    }
  }

  function errorWidget(text, sub) {
    return {
      type: 'widget',
      refreshAfter: refreshAfter,
      padding: 16,
      gap: 8,
      backgroundColor: '#1C1C1E',
      children: [
        { type: 'text', text: 'Muse用量', font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' },
        { type: 'text', text: text, font: { size: 'subheadline', weight: 'semibold' }, textColor: '#FF3B30' },
        { type: 'text', text: sub || '请检查 MUSE_USAGE_URL 或网络', font: { size: 'caption1' }, textColor: '#AAAAAA' }
      ]
    };
  }

  let data = null;
  let fromCache = false;

  if (!DATA_URL) {
    // 没配 URL 时直接读缓存，让用户先能看到上次的数据
    try { data = ctx.storage.getJSON(CACHE_KEY); } catch (e) { data = null; }
    if (data) fromCache = true;
    else return errorWidget('未配置数据地址', '在小组件 Env 里填 MUSE_USAGE_URL');
  } else {
    try {
      const resp = await ctx.http.get(DATA_URL, { timeout: 10000 });
      if (resp.status !== 200) throw new Error('HTTP ' + resp.status);
      const j = await resp.json();
      // 兼容两种字段：remaining_pct 或 remaining
      const remaining = (typeof j.remaining_pct === 'number') ? j.remaining_pct : (typeof j.remaining === 'number' ? j.remaining : null);
      if (remaining === null || isNaN(remaining)) throw new Error('bad json');
      data = j;
      data._remaining = remaining;
      try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) {}
    } catch (e) {
      try { data = ctx.storage.getJSON(CACHE_KEY); } catch (e2) { data = null; }
      if (data) {
        fromCache = true;
        if (typeof data._remaining !== 'number') {
          data._remaining = (typeof data.remaining_pct === 'number') ? data.remaining_pct : 0;
        }
      } else {
        return errorWidget('取不到数据', '网络失败且无缓存，3小时后重试');
      }
    }
  }

  const remaining = Math.max(0, Math.min(100, Math.round(data._remaining)));
  const used = (typeof data.used_pct === 'number') ? Math.round(data.used_pct) : (100 - remaining);
  const color = colorFor(remaining);
  const resetText = data.reset_time || (data.reset_time_iso ? fmtTime(data.reset_time_iso) : '');
  const updatedText = data.updated_at || (data.updated_at_iso ? fmtTime(data.updated_at_iso) : '');
  const cacheTag = fromCache ? ' · 缓存' : '';

  // 额外 Token 池：优先用 additional_tokens_remaining_pct，否则用 100 - additional_tokens_used_pct
  const addUsed = (typeof data.additional_tokens_used_pct === 'number') ? Math.round(data.additional_tokens_used_pct) : 0;
  const addRemaining = (typeof data.additional_tokens_remaining_pct === 'number')
    ? Math.max(0, Math.min(100, Math.round(data.additional_tokens_remaining_pct)))
    : Math.max(0, Math.min(100, 100 - addUsed));
  const addColor = colorFor(addRemaining);
  const addLeft = data.additional_tokens_left || '';

  // 锁屏小尺寸：只显示最关键的数字
  if (ctx.widgetFamily === 'accessoryRectangular') {
    return {
      type: 'widget',
      refreshAfter: refreshAfter,
      padding: 12,
      children: [
        { type: 'text', text: 'Muse 剩 ' + remaining + '% · 附加 ' + addRemaining + '%' + cacheTag, font: { size: 'headline', weight: 'bold' }, textColor: color }
      ]
    };
  }
  if (ctx.widgetFamily === 'accessoryCircular' || ctx.widgetFamily === 'accessoryInline') {
    return {
      type: 'widget',
      refreshAfter: refreshAfter,
      children: [
        { type: 'text', text: remaining + '%', font: { size: 'headline', weight: 'bold' }, textColor: color }
      ]
    };
  }

// 主屏幕（参考用户发的图）：两组进度条，周额度 + 额外 Token 池
  // 注意：中号小组件高度不够，8 行会溢出（顶部标题被顶掉、底部一行被切一半），
  // 所以中号只放 6 行核心内容；大号才放完整版（标题 + 底部说明）。
  const weeklyHeader = {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
    children: [
      { type: 'text', text: 'Muse 周额度', font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' },
      { type: 'spacer' },
      { type: 'text', text: '剩 ' + remaining + '%', font: { size: 'title', weight: 'bold' }, textColor: color }
    ]
  };
  const weeklyBar = {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
    children: [
      { type: 'image', src: barSvg(remaining, color, 150), width: 150, height: 10, borderRadius: 5 },
      { type: 'text', text: resetText + ' 重置', font: { size: 'caption1' }, textColor: '#FFFFFF', maxLines: 1 }
    ]
  };
  const weeklySub = { type: 'text', text: '免费档 · 已用 ' + used + '%', font: { size: 'subheadline' }, textColor: '#AAAAAA' };
  const addHeader = {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
    children: [
      { type: 'text', text: 'Muse 额外 Token 池', font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' },
      { type: 'spacer' },
      { type: 'text', text: '剩 ' + addRemaining + '%', font: { size: 'title', weight: 'bold' }, textColor: addColor }
    ]
  };
  const addBar = {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
    children: [
      { type: 'image', src: barSvg(addRemaining, addColor, 150), width: 150, height: 10, borderRadius: 5 },
      { type: 'text', text: '周额度用完后自动接管', font: { size: 'caption1' }, textColor: '#FFFFFF', maxLines: 1 }
    ]
  };
  const addSub = { type: 'text', text: '已用 ' + addUsed + '%' + (addLeft ? ' · 还剩约 ' + addLeft + ' tokens' : ''), font: { size: 'subheadline' }, textColor: '#AAAAAA' };

  if (ctx.widgetFamily === 'systemLarge') {
    return {
      type: 'widget',
      refreshAfter: refreshAfter,
      padding: 16,
      gap: 6,
      backgroundColor: '#1C1C1E',
      children: [
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
          children: [
            { type: 'text', text: 'Muse用量', font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' },
            { type: 'spacer' },
            { type: 'text', text: updatedText + cacheTag, font: { size: 'caption1' }, textColor: '#AAAAAA' }
          ]
        },
        weeklyHeader, weeklyBar, weeklySub, addHeader, addBar, addSub,
        { type: 'text', text: 'iOS 决定刷新间隔，非实时', font: { size: 'caption1' }, textColor: '#AAAAAA' }
      ]
    };
  }

  // 中号（默认）：紧凑版，6 行，刚好放下不被切
  return {
    type: 'widget',
    refreshAfter: refreshAfter,
    padding: 12,
    gap: 4,
    backgroundColor: '#1C1C1E',
    children: [weeklyHeader, weeklyBar, weeklySub, addHeader, addBar, addSub]
  };
}
