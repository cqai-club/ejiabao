<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ArrowDown, ArrowRight, ArrowUpRight, Camera, ChevronLeft, ChevronRight, Film, Megaphone, Mic2, Moon, Play, ShoppingBag, Sparkles, UserRound } from "lucide-vue-next";

const activeCase = ref(1);
const isDark = ref(document.body.dataset.theme === "dark");
const cases = [
  { image: "/assets/cases/case-portrait.jpg", label: "人物特写·数字人口播" },
  { image: "/assets/cases/case-product.jpg", label: "商品质感·动态展示" },
  { image: "/assets/cases/case-stage.jpg", label: "现场发声·活动预告" }
];
const types = [
  ["commerce", "商品推广", "让静态商品拥有镜头与节奏", ShoppingBag, "#a46bff", "/assets/cases/case-product.jpg"],
  ["talking", "知识口播", "把复杂内容讲成清晰故事", UserRound, "#45e7ff", "/assets/cases/case-portrait.jpg"],
  ["story", "剧情短片", "从设定开始构建一个世界", Film, "#ffcf5a", "/assets/cases/case-city.jpg"],
  ["vlog", "Vlog", "把真实片段剪成完整故事", Camera, "#22d6a8", "/assets/cases/case-food.jpg"],
  ["mix", "文生播客", "一段文案，生成有画面的声音故事", Mic2, "#8feaff", "/assets/cases/case-creator.jpg"],
  ["event", "活动预告", "让重要的时刻提前发生", Megaphone, "#ff8a5c", "/assets/cases/case-stage.jpg"]
] as const;

const currentCases = computed(() => cases.map((item, index) => ({ ...item, state: index === activeCase.value ? "is-active" : index === (activeCase.value + cases.length - 1) % cases.length ? "is-prev" : index === (activeCase.value + 1) % cases.length ? "is-next" : "" })));

function enterApp(typeKey?: string) {
  window.enterApp?.(typeKey);
}

function backLogin() {
  window.showAuth?.(false);
}

function toggleTheme() {
  window.toggleTheme?.();
  isDark.value = document.body.dataset.theme === "dark";
}

function shiftCase(offset: number) {
  activeCase.value = (activeCase.value + offset + cases.length) % cases.length;
}

let timer = 0;
onMounted(() => {
  timer = window.setInterval(() => shiftCase(1), 5000);
});
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <section class="landing-page" id="landingPage" aria-labelledby="landing-title">
    <div class="landing-shell">
      <header class="landing-nav">
        <a class="landing-brand" href="#top" aria-label="返回首页"><img src="/assets/ejiabao-logo-new.jpg" alt="品牌标识"></a>
        <nav class="landing-nav-links" aria-label="首页导航"><a href="#capabilities">能力</a><a href="#cases">案例</a><a href="#process">流程</a><a href="#scenes">场景</a></nav>
        <div class="landing-actions">
          <button class="landing-button" id="landingThemeToggle" type="button" aria-label="切换深浅主题" @click="toggleTheme"><Moon :size="16" aria-hidden="true" /></button>
          <button class="landing-button" type="button" @click="backLogin"><LogIn :size="16" aria-hidden="true" />返回登录页</button>
          <button class="landing-button is-primary" type="button" @click="enterApp()"><ArrowUpRight :size="16" aria-hidden="true" />进入工作台</button>
        </div>
      </header>

      <main id="top">
        <section class="landing-hero">
          <div class="landing-hero-copy">
            <span class="landing-overline"><Sparkles :size="16" aria-hidden="true" />AI VIDEO CREATION / 01</span>
            <h1 id="landing-title">让想法拥有<br><em>自己的镜头语言。</em></h1>
            <p>从一句话、一张图或一段实拍开始。让云端理解你的意图，生成有节奏、有情感、也有你个人判断的短视频。</p>
            <div class="landing-hero-actions"><button class="landing-button is-primary" type="button" @click="enterApp()"><Play :size="16" aria-hidden="true" />开始创作</button><a class="landing-button" href="#cases"><ArrowDown :size="16" aria-hidden="true" />浏览案例</a></div>
          </div>
          <div class="landing-hero-art">
            <div class="hero-media-window">
              <button class="hero-carousel-arrow is-prev" id="heroPrev" type="button" aria-label="上一组案例" @click="shiftCase(-1)"><ChevronLeft :size="18" aria-hidden="true" /></button>
              <div class="hero-media-track"><div v-for="item in currentCases" :key="item.image" class="hero-media-item" :class="item.state"><img :src="item.image" :alt="item.label"></div></div>
              <button class="hero-carousel-arrow is-next" id="heroNext" type="button" aria-label="下一组案例" @click="shiftCase(1)"><ChevronRight :size="18" aria-hidden="true" /></button>
            </div>
          </div>
        </section>

        <section class="landing-section" id="capabilities"><div class="landing-section-head"><div><h2>创作不是堆工具，<br>而是找到合适的下一步。</h2></div><p>六类入口，一套连续的创作体验。你可以从最熟悉的素材开始，也可以从一个还没有形状的念头开始。</p></div><div class="landing-type-strip"><button v-for="[key, title, copy, Icon, color, image] in types" :key="key" class="landing-type-card" :style="{ '--type-color': color, '--type-image': `url('${image}')` }" type="button" @click="enterApp(key)"><span class="type-symbol"><component :is="Icon" :size="16" aria-hidden="true" /></span><span><strong>{{ title }}</strong><span>{{ copy }}</span></span></button></div></section>

        <section class="landing-section" id="cases"><div class="landing-section-head"><div><h2>一些已经发生的画面</h2></div><p>从商品、人物到城市与现场，每一类素材都可以成为下一支片子的起点。</p></div><div class="case-wall"><article v-for="item in [{i:'case-portrait.jpg',t:'人物特写',s:'知识口播 · 数字人口播'},{i:'case-product.jpg',t:'商品质感',s:'商品推广 · 动态展示'},{i:'case-food.jpg',t:'日常风味',s:'Vlog · 实拍精剪'},{i:'case-city.jpg',t:'城市街巷',s:'剧情短片 · 文生视频'},{i:'case-stage.jpg',t:'现场发声',s:'活动预告 · 快宣物料'},{i:'case-creator.jpg',t:'声音与画面',s:'文生播客 · 音频可视化'}]" :key="item.i" class="case-card"><img :src="`/assets/cases/${item.i}`" :alt="`${item.t}案例`"><div class="case-meta"><strong>{{ item.t }}</strong><span>{{ item.s }}</span></div></article></div></section>

        <section class="landing-section" id="process"><div class="landing-section-head"><div><h2>从灵感到成片，<br>每一步都清晰。</h2></div><p>你不需要先理解模型，只需要知道自己想表达什么。其余的工作，交给一条看得见的创作路径。</p></div><div class="landing-process"><div v-for="step in [['01 / SELECT','选一种表达','确定你想做的内容类型。'],['02 / FEED','交付手边素材','图片、脚本、视频或一句话描述。'],['03 / GENERATE','云端展开画面','镜头、声音与节奏自动成形。'],['04 / REFINE','留下你的版本','审片、调整，导出并发布。']]" :key="step[0]" class="landing-process-step"><small>{{ step[0] }}</small><strong>{{ step[1] }}</strong><p>{{ step[2] }}</p></div></div></section>

        <section class="landing-section" id="scenes"><div class="landing-footer-cta"><div><h2>让每个想法，都有一条通向画面的路。</h2><p>现在进入工作台，开始你的下一支片子。</p></div><button class="landing-button is-primary" type="button" @click="enterApp()"><ArrowRight :size="16" aria-hidden="true" />进入工作台</button></div><div class="landing-note"><span>AI VIDEO CREATION SPACE</span><span>Windows Desktop · Cloud Processing</span></div></section>
      </main>
    </div>
  </section>
</template>
