# 架构

## 2026-10-14 · 本地辅助抠图

- `utils/cutout-segmentation.ts`：框外背景、用户前/背景硬标记和初始框内前景，五分量对角协方差颜色模型、四邻域边缘权重、非递归 Dinic 最小割，最多三轮。最长边 256，建模/建图/最大流均检查取消/10 秒期限并按时间分片；不是衣物语义识别。
- `CutoutMask` 管理最长边 1024 的蒙版、硬标记、连续圆头笔画、偶奇圈选和最多十步撤销。挂起笔画在双指/取消时回滚，只松一指后等待全松开。`rendering/cutout-editor.ts` 统一缩放/平移和落笔坐标，预览工作 Canvas 复用像素缓冲，按帧绘制。
- `pages/garment-cutout/` 负责工具与异步状态；使用页面内原生 2D Canvas 读取照片，不强依赖离屏 API。导出独立 Canvas，将原 RGB/alpha 与蒙版相乘，3×3 轻微软边、可见边界外留两像素，始终导出 PNG；白底和棋盘格只参与预览。全透明结果拒绝应用。
- `cutout-session.ts` 通过单次内存会话传递源路径/结果，不把图片/像素写入路由或 setData。回传验证源图/请求代次、页面存活及衣物 updatedAt；使用结果只改变表单，衣物保存成功才持久化。
- `GarmentImage.originalPath?` 兼容 version 1；displayPath/overlayPath 共用一份 PNG，originalPath 保留原图，重新抠图从原图开始。文件准备按源路径去重，提交前后校验 expectedUpdatedAt，失败只回滚新副本，成功后按所有衣物引用清理旧文件。恢复原图清除贴图，图片改变使 fitting 失效。普通穿搭读取最新图，日历既有副本不变。

## 2026-10-13 · 搜索品类漏项修复

- 衣橱管理/自由搭配统一调用 `filterGarments`，关键词同时匹配衣物名称或 `getCategoryName` 的品类名，去首尾空白、忽略英文大小写。分类/颜色/季节/风格依然与关键词共同生效，不按衣物名字去重；列表以 ID 为 key，选择不会隐藏同层其他候选。试衣目录原先已支持名称/品类匹配。

## 2026-10-13 · 自由搭配画布与手动叠放

- `Outfit` 在 version 1 上兼容新增可选 `kind`、`board`；`OutfitBoardItem` 保存衣物 ID、0–100 方形逻辑坐标、缩放/旋转/叠放顺序。`outfit-board.ts` 校验、深拷贝、补齐、重排与稳定签名；板内每个引用恰有一个位置，缺失衣物位置保留。模特 `OutfitItem` 可选 `zIndex` 独立保存手动叠放，未设置时沿用既有物理层序。
- `OutfitService.createFree` 接收选填名称，非空沿用名称长度校验/去首尾空白，留空自动生成日期标签并区分重名；衣橱底部内嵌输入框，不弹命名框，跨筛选/显示及失败保留，成功清空。详情标题显示保存名称。`saveBoard` 只更新排列及 revision，不改模特变换。模特换衣更新时按 ID 保留仍存在的画布位置，补齐新衣物位置。长按置顶只重排当前有效试衣衣物，不改失效引用，仍可通过原有原样保留校验。
- `rendering/outfit-board.ts` 绘制原展示图和透明内容边界，无人体/网格变形；绘制/命中共用叠放顺序与逻辑坐标。`components/outfit-board` 复用 `GarmentGestures`，单指滚屏、轻点选择、长按拖动置顶、双指变换；独立图片缓存、异步/卸载保护和坏图占位，连续调整不重新解码/分配画布。
- 衣橱独立草稿增加可收起的紧凑画布，手势锁定时暂停外层 scroll-view；成功直接保存并清空，失败保留选衣及排列。详情默认可编辑画布，点击模特页签才读取身材；未保存排列保护离开及进入试衣，页面返回不覆盖草稿。回收站画布只读。
- 穿搭卡片删除 `catchtap` 阻止打开详情，版本检查/确认/忙状态/失败后刷新沿用可恢复删除。删除不写衣橱和日历，不清理其图片。

## 2026-10-13 · 穿搭日历

- `models/outfit-calendar.ts` 定义日期记录/穿搭快照/衣物信息，`calendar-date.ts` 负责本地今天、月历 42 格、周一起始、跨月与闰年（1900–2199）。`outfit-calendar.ts` 校验/深拷贝日期、12 套上限、1000 字备注与归档路径。
- `LocalOutfitCalendarRepository` 独立保存 `smart-wardrobe.calendar.v1`，日期唯一且逐日 revision；损坏快照拒绝写入。空日期保留版本，不因移除最后一套/清空备注导致旧页面重新覆盖。
- `OutfitCalendarService` 从已保存的活动穿搭生成当时名称/衣物名/图层/变换快照；`calendar-images.ts` 将原展示图复制为 `USER_DATA_PATH/calendar_*` 独立照片，无身材/上传。支持模拟器 `http://usr` 本地路径，拒绝外部 HTTP 图片；存档不依赖原衣橱图片生命周期。
- 多选添加逐张准备、日期一次提交；失败/版本冲突清理本次新副本。移除按剩余日期引用保护照片，写入成功后尽力清理专用文件，绝不清理原 `garment_*`。文件清理失败可能留下无引用副本，暂未加入全局清理器。
- `pages/outfit-calendar/` 处理选日/月/今天、当日多套图卡、多选搜索、注意事项编辑与显式保存。切日/去自由搭配前保存确认；取消/写入失败保留，离页用原生未保存警告。异步存档期间禁止改日期，卸载后不更新页面；原图丢失有文字回退。首页快捷卡、穿搭列表顶部提供入口。

- 原生微信小程序代码位于 `miniprogram/`，使用 TypeScript、WXML、WXSS；项目配置启用 TypeScript 编译插件。
- `app.json` 配置 `lazyCodeLoading: "requiredComponents"`，按访问页面注入页面及依赖组件；自定义组件只在使用它们的页面 JSON 声明，无全局组件声明。未启用额外的占位组件/用时注入。
- 第一阶段实现四个底部导航页和全局样式；业务类型位于 `miniprogram/models/`。
- 第二阶段已加入两级分类配置、衣物服务、本地 Repository 与图片服务，衣物表单/列表/详情页可调用这些模块。
- 第三阶段加入身材服务与 Repository、身材表单、我的参数摘要和试衣人体预览。`rendering/` 分离逻辑轮廓/锚点、统一比例适配、Canvas 绘制，`components/body-preview/` 管理节点与尺寸重测。
- 第四阶段加入 `config/try-on.ts`（分类映射、图层和调整范围）、`services/try-on-session.ts`（内存草稿/互斥/核对）、`rendering/garment-layout.ts`/`garment-images.ts`/`draw-garments.ts`（锚点布局、缓存/回退和图层绘制）。人体和衣物共用画布变换。
- `body-preview` 管理异步版本、图片加载与画布手势；`rendering/garment-gestures.ts` 独立处理命中、长按拖动、双指相似变换和滚动/调整状态。参数变化复用已加载图片直接重绘；试衣页开启 `interactive` 并接收选择/变换/置顶事件，详情的可选模特预览只读，默认画布可编辑。试衣页管理选择、调整与保存，衣物详情可直接试穿。
- 第五阶段加入 `LocalOutfitRepository`、`OutfitService`、`outfit-validation`/`outfit-resolution`、穿搭列表/详情页及首页入口。独立版本化快照只保存衣物引用与参数，`revision` 拦截过期写入，`deletedAt` 用于可恢复回收站。
- 试衣会话跟踪编辑来源、名称、基线及不可用引用；用户确认保留缺失衣物位置，载入不丢失，替换/主动移除才更改。未保存草稿仍在内存中，保存成功才更新基线。
- 未设置身材时示例不自动保存；见 `docs/architecture.md` 与 `docs/development-plan.md`。
- 衣橱页使用独立的 `TryOnSession` 实例管理选衣草稿，复用图层/互斥规则；调用 `OutfitService.createFree` 直接保存，可选画布排列，无需人体，也不修改共享 2D 试衣会话。选衣与普通详情点击按模式分开，选择变动不重置列表滚动锚点。
- `wardrobe-navigation.ts` 为首页/穿搭列表/试衣页提供进入自由搭配的单次内存意图，衣橱 `onShow` 消费后进入选衣并清除旧筛选，保留已选衣物；导航失败清理当前请求，无持久化导航标记。衣橱顶部用两段按钮区分管理/搭配，保存成功继续留在搭配模式。
- 试衣“开始新一套”仍通过 `TryOnSession.startNew()` 重置，不创建空的持久穿搭；未保存修改先确认，确认后清空名称/编辑来源/筛选，下一渲染周期定位 `#garmentCatalog` 并提示。取消或弹窗失败保留草稿。
- 身材保持 version 1，新增可选实测长度，男女内部模板 ID 不变；表单用 WeakMap 分别暂存本页男女输入，保存当前所选模特。渲染缺省比例不写入存储。`body-model.ts` 输出肩/腰/臀/裆/膝及体段尺寸，`draw-body.ts` 本地曲线与渐变绘制陈列模特。
- `image-content.ts` 只分析 alpha 可见边界和躯干宽度比例；`CanvasImageCache` 在原生离屏 Canvas 上缩采样到最长 384 像素并按图片缓存结果，像素读取不支持时回退原图。裁切来源仅用于绘制，不改原图片；`placeGarment`、选框及手势命中共用内容边界，原图模式依然等比绘制，分区模式见下文；不模拟真实布料。

## 2026-10-13 · 本地分区变形

- `models/garment-fitting.ts` 与 `utils/garment-fitting.ts` 定义校准、分类映射、校验与图片绑定；Garment 可选 fitting，快照 version 1 不变。服务保留最新有效校准并在换图/品类后清除；专用保存检查 updatedAt，Repository 拒绝坏记录。
- `image-content.ts` 增加归一化剪影行与 cutout，区分透明外框的矩形照片和剪影。`garment-rig.ts` 提供规则初值；只有透明剪影自动尝试，普通照片/不支持品类用原图。
- `garment-mesh.ts` 以肩/腋/腰臀/裆/膝锚点生成分区细分三角形；袖子与衣身共享根部，裤裆和两腿连续。拒绝退化或反向片；不会为了完成绘制绕过保护。
- `draw-garment-mesh.ts` 求仿射矩阵并裁切绘图，平行外扩裁切缓解白缝；离屏纹理加仅作用于衣物 alpha 的明暗。连续变换复用纹理，无离屏支持时直接画网格。`draw-body.ts` 局部补绘手/颈前景；不作完整姿态遮挡。
- 变形后的 bounds 用于变换中心/选框，三角形用于手势命中。`body-preview` 的 assetKey 包含校准和版型；改变人体或素材重建，调整 transform 直接重绘。
- `draw-calibrator.ts` 独立负责坐标/命中/标记；组件管理图片和触摸，空白滑动不改点；页面负责草稿、余量/袖长/长度、预览与显式保存。校准坐标是原图片 0–1，不持久化人体坐标或纹理。

## 2026-10-13 · 预渲染白模固定正面

- `mannequin-mesh.ts` / `mannequin-raster.ts` 是开发时生成源码：三维截面、面部/发型/手足/基础衣裤、法线光照与深度遮挡。`scripts/generate-mannequin-assets.mjs` 使用开发环境的 Canvas 模块，输出 assets/mannequin/ 两张九格 PNG（约 165 KiB）。运行时不调用三维软件光栅化；最初的运行时生成方案在微信模拟器超时，已替换。
- `mannequin-atlas.ts` 使用独立 CanvasImageCache 加载本地九格，不被衣物 cache.retain 清掉；来源人体沿用男女示例。`mannequin-warp.ts` 按肩/胸/腰/臀/裆/膝重映射源纵坐标，按部件围度/中心适配横向，手臂和衣身分别适配；标准身材直接绘制完整部件。透明行适当重叠缓解白缝，照明是开发时烘焙的近似效果。
- `mannequin-surface.ts` 将适配结果存入原生离屏纹理，按 BodyModel/图集/基础层/指定前景部件缓存；WeakMap 随旧模型回收。离屏失败当前模型只尝试一次，后续直接绘制图集；图集缺失时用旧曲线回退并提示。运行时不依赖像素读写、WebGL 或网络。
- `body-preview` 按身材内容复用 BodyModel，同身材换图/改校准不重建人体；连续衣物变换复用白模/衣物纹理。白模加载和衣物加载均有版本/卸载保护；图集加载只切换当前性别。
- 基础上衣/短裤只作渲染占位，不加入衣橱、会话或穿搭。实际成功加载的上装/外套隐藏基础上衣，下装隐藏短裤，连体装同时隐藏。手颈前景只绘对应部件，避免覆盖真实衣物。
- 沿用 BodyModel 尺寸与锚点，极端围度只扩展适配边界以包住基础衣裤，原身材记录/校准坐标和持久化结构不变。当前不暴露转身或完整 3D 衣物。
