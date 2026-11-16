// Muse 额度小组件 for Egern
// generic 类型脚本，放到 Egern -> 工具 -> 脚本，名称 muse-usage，类型 generic，本地文件 muse-usage.js
// 环境变量 MUSE_USAGE_URL：指向 muse-usage.json 的公开直链，例如 GitHub Raw URL
//   https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/muse-usage.json
// 数据格式见同目录 muse-usage.json
// 逻辑：每次刷新先拉取远程 JSON，成功就写入缓存；拉不到就读缓存显示，并标注“缓存”；连缓存都没有才显示“暂无数据”
// 颜色：剩余额度 >=25% 绿色，<25% 黄色，<10% 红色
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

  function barSvg(remaining, color) {
    const w = 280;
    const h = 10;
    const fillW = Math.max(0, Math.min(w, Math.round((w * remaining) / 100)));
    const c = color.replace('#', '%23');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + " " + h + "'><rect x='0' y='0' width='" + w + "' height='" + h + "' rx='5' fill='%23333338'/><rect x='0' y='0' width='" + fillW + "' height='" + h + "' rx='5' fill='" + c + "'/></svg>";
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
        { type: 'text', text: 'Muse 额度', font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' },
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
  const statusText = remaining < 10 ? '额度告急' : remaining < 25 ? '额度偏低' : '额度充足';

  // 锁屏小尺寸：只显示最关键的数字
  if (ctx.widgetFamily === 'accessoryRectangular') {
    return {
      type: 'widget',
      refreshAfter: refreshAfter,
      padding: 12,
      children: [
        { type: 'text', text: 'Muse 剩 ' + remaining + '%' + cacheTag, font: { size: 'headline', weight: 'bold' }, textColor: color }
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

  // 主屏幕中尺寸（推荐）：标题 + 大数字 + 进度条 + 重置时间 + 更新时间
  return {
    type: 'widget',
    refreshAfter: refreshAfter,
    padding: 16,
    gap: 8,
    backgroundColor: '#1C1C1E',
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
        children: [
          { type: 'text', text: 'Muse 额度', font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' },
          { type: 'spacer' },
          { type: 'text', text: statusText + cacheTag, font: { size: 'caption1', weight: 'semibold' }, textColor: color }
        ]
      },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
        children: [
          { type: 'text', text: '剩 ' + remaining + '%', font: { size: 'title', weight: 'bold' }, textColor: color },
          { type: 'text', text: '已用 ' + used + '%', font: { size: 'subheadline' }, textColor: '#AAAAAA' }
        ]
      },
      {
        type: 'image',
        src: barSvg(remaining, color),
        width: 280,
        height: 10,
        borderRadius: 5
      },
      { type: 'text', text: '重置：' + resetText, font: { size: 'subheadline' }, textColor: '#FFFFFF' },
      { type: 'text', text: '更新：' + updatedText + (data.additional_tokens_left ? ' · 附加 ' + data.additional_tokens_left + ' 剩' : ''), font: { size: 'caption1' }, textColor: '#AAAAAA', maxLines: 1 }
    ]
  };
}
