# 核心数据模型

类型声明位于 `miniprogram/models/`。衣物、身材与穿搭记录均已落地，试衣会话使用 `OutfitItem`。

- `Garment`：系统生成的 ID、分类路径、展示图片路径、可选试衣贴图路径、名称及可选属性、创建/修改时间。图片路径对应持久本地文件。
- `BodyProfile`：男/女模板与用户原始身高、体重、胸腰臀数据、修改时间；可选 `shoulderWidthCm`（肩宽）、`torsoLengthCm`（肩线到腰线）、`inseamCm`（裆底到地面）、`underBustCm`（女模下胸围）。未填写时字段不存在，旧 version 1 可直接读取，画布坐标与估算值不写入记录。
- `Outfit`：系统生成的 ID、名称、引用的 `OutfitItem[]`、创建/修改时间、递增 `revision`、可选删除时间 `deletedAt`；可选 `kind: free | try-on` 和 `board: OutfitBoardItem[]`，旧 version 1 无这些字段仍有效。
- `OutfitItem`：衣物 ID、图层槽位、模特贴图的相对平移/缩放/旋转参数；可选 `zIndex` 保存手动置顶顺序，未设置沿用默认层序。
- `OutfitBoardItem`：衣物 ID、独立画布 `x/y`（0–100）、`scale`（0.25–3）、`rotationDeg`（±180°）和 `zIndex`（0–1000 安全整数）。一套内每个引用恰有一个位置，缺失衣物仍保留；旧记录预览时补默认位置。
- `CategoryGroup` 与 `CategoryType`：稳定 ID、展示名称；当前仅两级分类，配置集中维护。

ID 为内部字段，用户无需填写。衣物使用 `smart-wardrobe.garments.v1`；身材使用 `smart-wardrobe.body-profile.v1`，快照为 `{ version: 1, profile }`。损坏数据会报错且阻止覆盖。身材的身高限定 150–200cm，体重与围度要求有限正数，不设上限；保存原始数值及小数，不保存绘制时的推算限制。

穿搭使用 `smart-wardrobe.outfits.v1`，快照为 `{ version: 1, outfits }`。保存的名称为 1–60 字符（去首尾空白）；自由搭配输入选填，留空/纯空白自动生成日期标签并区分重名；版本号和时间由系统维护。画布排列和模特参数独立保存，排列保存同样检查 revision；损坏记录、重复 ID、坏图层/位置/参数会阻止覆盖。

穿搭不复制衣物、图片或身材。用户确认删除衣物后保留穿搭引用，列表/详情标记缺失；编辑时原样保留失效位置，除非用户替换或移除。恢复回收站穿搭不会恢复衣物。活动列表不包含带 `deletedAt` 的记录。

当前试衣只使用 `top`、`bottom`、`outer`、`one-piece` 图层，每层最多一件；`accessory` 仍为未来契约。平移以人体逻辑 cm 记录（±200），等比缩放为 0.25–3 倍，旋转为 ±180°。尺寸变化只重新适配画布，不改变这些值。`TryOnGarment` 是展示/绘制时将 `OutfitItem` 与当前衣物关联后的临时对象，不写入本地记录。

## 衣物贴合校准（2026-10-13）

Garment 新增可选 `fitting: GarmentFitting`；旧快照 version 1 无此字段仍有效。记录包含 version 1、有效 imagePath、typeId、kind（upper/pants/skirt/dress）、mode（adapt/original）、ease（fitted/regular/loose）、sleeve、length 和 points。点是原图归一化 0–1 坐标，含所需领/肩/腋/腰臀/下摆/袖口/裆/裤脚，不是人体 cm；按品类和袖型校验必需点、有限坐标及交叉。

普通编辑保留最新且绑定仍有效的校准；更换当前试衣有效图片（优先 overlayPath）或品类自动清除。只换非试衣展示照片而贴图不变可保留。专用校准保存校验 expectedUpdatedAt，失败不覆盖。校准归属衣物，穿搭引用不复制它，预览使用当前校准；网格和离屏纹理不持久化。
