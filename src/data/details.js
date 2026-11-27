// 有交互演示的算法补充：核心步骤 | 伪代码 | 一句话要点
// 格式：id: ['步骤1|步骤2|步骤3', '伪代码(用 \n 换行)', '要点 / 常见坑']
const DETAILS = {
  'bubble-sort': [
    '从左到右比较相邻元素|逆序则交换，最大值沉到区间末尾|缩小待排序区间，无交换可提前结束',
    'for i = 0 .. n-2:\n  swapped = false\n  for j = 0 .. n-i-2:\n    if a[j] > a[j+1]: swap(a[j], a[j+1]); swapped = true\n  if not swapped: break',
    '稳定且原地，但 O(n²)；加「本轮无交换」标志后，近乎有序输入退化为 O(n)。'],
  'selection-sort': [
    '在未排序区间扫描出最小值位置|与区间首个元素交换|已排序区间右扩一格',
    'for i = 0 .. n-2:\n  m = argmin(a[i..n-1])\n  swap(a[i], a[m])',
    '交换次数固定 O(n)，但比较次数始终 O(n²)，且默认实现不稳定。'],
  'insertion-sort': [
    '取出当前元素作为待插入值|把前缀中比它大的元素逐位右移|空出位置后写入',
    'for i = 1 .. n-1:\n  key = a[i]; j = i-1\n  while j >= 0 and a[j] > key:\n    a[j+1] = a[j]; j--\n  a[j+1] = key',
    '小规模或近乎有序时极快，是 TimSort 与快速排序小区间优化的基础。'],
  'quick-sort': [
    '选一个基准 pivot|分区：小的放左、大的放右|递归处理左右子区间',
    'quick(a, lo, hi):\n  if lo >= hi: return\n  p = partition(a, lo, hi, pivot)\n  quick(a, lo, p-1); quick(a, p+1, hi)',
    '基准决定复杂度：有序输入 + 首元素基准会退化到 O(n²)；随机化或三数取中可规避。'],
  'merge-sort': [
    '递归把区间二分为最小单元|用双指针合并两个有序段|逐层向上写回原数组',
    'merge_sort(a, lo, hi):\n  mid = (lo+hi)/2\n  merge_sort(a, lo, mid); merge_sort(a, mid+1, hi)\n  merge(a, lo, mid, hi)',
    '时间恒为 O(n log n) 且稳定，代价是 O(n) 辅助空间；适合链表与外部排序。'],
  'heap-sort': [
    '把数组原地建成大顶堆|交换堆顶与当前末尾，最大值归位|对缩小后的堆执行下沉',
    'build_max_heap(a)\nfor i = n-1 .. 1:\n  swap(a[0], a[i])\n  sift_down(a, 0, i)',
    '最坏 O(n log n)、空间 O(1)，但缓存局部性差且不稳定，实践常慢于快排。'],
  'binary-search': [
    '维护闭区间 [lo, hi] 与循环不变量|取 mid 比较目标值|按比较结果收缩半边直到命中或区间为空',
    'lo, hi = 0, n-1\nwhile lo <= hi:\n  mid = lo + (hi-lo)//2\n  if a[mid] == x: return mid\n  elif a[mid] < x: lo = mid+1\n  else: hi = mid-1',
    '注意 mid 溢出、边界开闭与「找第一个 ≥ x」的变体；有序是硬前提。'],
  'bfs': [
    '起点入队并标记已访问|弹出队首，把未访问邻居入队|按层扩张直到队列为空',
    'q = [start]; visited[start] = true\nwhile q:\n  u = q.pop(0)\n  for v in adj[u]:\n    if not visited[v]: visited[v] = true; q.push(v); dist[v] = dist[u]+1',
    '首次访问即无权图最短步数；记录前驱可还原路径，队列大小体现「当前层」。'],
  'dijkstra': [
    '起点距离置 0，其余无穷|用优先队列取距离最小的未定点|松弛其所有出边并更新距离表',
    'dist[s] = 0; pq = [(0, s)]\nwhile pq:\n  (d, u) = pq.pop_min()\n  if d > dist[u]: continue\n  for (v, w) in adj[u]:\n    if dist[u]+w < dist[v]: dist[v] = dist[u]+w; pq.push((dist[v], v))',
    '边权必须非负，否则需要 Bellman-Ford；堆优化后为 O((V+E)log V)。'],
  'knapsack': [
    '定义 dp[i][j]：前 i 件、容量 j 的最大价值|每件物品取「不选 / 选」两者较大|从末格回溯取出选中物品',
    'for i = 1 .. n:\n  for j = 0 .. W:\n    dp[i][j] = dp[i-1][j]\n    if j >= w[i]:\n      dp[i][j] = max(dp[i][j], dp[i-1][j-w[i]] + v[i])',
    '01 背包容量倒序可滚动成 O(W)；完全背包则正序，两者别混。'],
  'n-queens': [
    '逐行尝试放置一个皇后|用列与主副对角线集合检查冲突|冲突则撤销并尝试下一列',
    'dfs(row):\n  if row == n: record()\n  for col in 0 .. n-1:\n    if safe(row, col):\n      place(row, col); dfs(row+1); remove(row, col)',
    '用三个布尔数组或位掩码把冲突判断降到 O(1)，是剪枝威力的最佳示例。'],
  'hash-table': [
    '对键求哈希并映射到桶下标|桶内有冲突则按策略处理|负载因子超阈值时扩容重哈希',
    'i = hash(key) % m\n# 链地址: bucket[i].append((key, val))\n# 线性探测: while slot[i] occupied: i = (i+1) % m',
    '负载因子决定冲突率；线性探测有聚集问题，删除需墓碑标记。'],
  'lru-cache': [
    '查哈希表判断命中|命中则把节点移到链表头部|未命中则插入头节点，超容量淘汰尾节点',
    'get(k): if k in map: move_to_head(node); return node.v\nput(k, v):\n  if k in map: update; move_to_head\n  else: add_to_head; if size > cap: remove_tail()',
    '哈希表定位 + 双向链表保证 O(1) 删除，是缓存淘汰策略的面试常客。'],
  'gradient-descent': [
    '计算当前参数处的损失梯度|沿负梯度方向按学习率更新|重复直到收敛或发散',
    'for t = 1 .. T:\n  g = ∇L(w)\n  v = μ·v - η·g      # 动量可选\n  w = w + v',
    '学习率过大直接发散；动量抑制震荡，Adam 进一步做逐参数自适应。'],
  'linear-regression': [
    '构造多项式特征矩阵 X|用最小二乘解 (XᵀX)⁻¹Xᵀy|在测试点上对比拟合误差',
    'w = (XᵀX + λI)⁻¹ Xᵀ y\ny_hat = X·w',
    '阶数升高会先降误差后急剧过拟合；正则化与交叉验证是控制手段。'],
  'logistic-regression': [
    '线性打分 z = w·x|经 sigmoid 转成概率|用交叉熵梯度迭代更新并加正则',
    'p = σ(w·x + b)\nL = -[y·log p + (1-y)·log(1-p)] + λ||w||²\nw -= η·Xᵀ(p - y)',
    '输出是概率，需校准才可直接用于 CTR 出价；线性边界无法拟合环形数据。'],
  'knn': [
    '计算查询点到所有训练样本的距离|取距离最小的 k 个邻居|按邻居标签多数投票或加权平均',
    'd_i = ||x - x_i||²\nidx = argsort(d)[:k]\nŷ = mode(y[idx])',
    'k 小则边界碎、易过拟合；k 大则边界平滑、欠拟合。特征必须标准化。'],
  'kmeans': [
    '初始化 k 个质心|把每个点分配给最近质心（E 步）|重算各簇均值作为新质心（M 步）',
    'repeat:\n  c_i = argmin_k ||x_i - μ_k||²\n  μ_k = mean(x_i where c_i = k)\nuntil assignments unchanged',
    '目标函数单调下降但只保证局部最优；k 与初始化敏感，K-Means++ 可缓解。'],
  'dbscan': [
    '统计每个点 eps 邻域内的点数|邻域点数 ≥ minPts 标记为核心点|从核心点按密度可达扩张成簇',
    'for p in points:\n  if |N_eps(p)| >= minPts:\n    expand_cluster(p, N_eps(p))\nelse if not reachable: mark as noise',
    '无需预设簇数、能识别任意形状与噪声，但对 eps/minPts 和密度不均很敏感。'],
  'decision-tree': [
    '枚举所有特征与候选切分点|按基尼不纯度或信息增益选最优切分|递归划分直到达到停止条件',
    'split = argmax_{(f,t)} ΔGini(D, f, t)\nD_left, D_right = partition(D, split)\nbuild_tree(D_left); build_tree(D_right)',
    '深度、最小叶样本数、剪枝是控制过拟合的三个旋钮；树边界是轴平行的。'],
  'svm': [
    '寻找最大化间隔的分离超平面|引入松弛变量允许少量错分|用核函数把样本映射到高维',
    'min ½||w||² + C·Σξ_i\ns.t. y_i(w·φ(x_i)+b) ≥ 1 - ξ_i',
    'C 越大越不容错、间隔越窄；只有支持向量影响最终边界。'],
  'pca': [
    '中心化并计算协方差矩阵|求特征值与特征向量，按方差排序|取前 k 个主成分做投影',
    'X̃ = X - mean(X)\nC = X̃ᵀX̃ / n\neig(C) → [v₁…v_d], sort by λ\ndesc\nZ = X̃·V_k',
    '主成分是方差方向不是分类方向；投影前必须标准化量纲不同的特征。'],
  'gradient-boosting': [
    '以常数或均值作为初始预测|计算当前预测的负梯度（残差）|训练弱学习器拟合残差并按学习率累加',
    'F₀ = argmin_γ Σ L(y_i, γ)\nfor m = 1 .. M:\n  r_i = -∂L/∂F(x_i)\n  h_m = fit_tree(x, r)\n  F_m = F_{m-1} + η·h_m',
    '轮数过多会过拟合；学习率越小需要的轮数越多，二者要一起调。'],
  'monte-carlo-pi': [
    '在 [0,1]² 内均匀采点|统计落在四分之一圆内的比例|比例乘以 4 即为 π 的估计',
    'for i = 1 .. N:\n  x, y ~ U(0,1)\n  if x² + y² <= 1: hit++\nπ̂ = 4·hit/N',
    '误差按 1/√N 下降：样本翻 100 倍，精度才提高约 10 倍。'],
  'simulated-annealing': [
    '从当前解随机扰动生成候选|若更优则接受，否则按 exp(Δ/T) 概率接受|按降温系数降低温度并重复',
    'T = T0\nfor step:\n  x′ = perturb(x); Δ = f(x′) - f(x)\n  if Δ > 0 or rand() < exp(Δ/T): x = x′\n  T *= α',
    '温度高时广撒网、温度低时精修；降温过快会退化为局部爬山。'],
  'bpe-tokenizer': [
    '统计语料中所有相邻符号对的频次|合并频次最高的一对并更新词表|重复直到达到合并轮数，再切分新文本',
    'vocab = chars(corpus)\nfor t = 1 .. T:\n  pair = argmax_count(adjacent_pairs)\n  merge_all(pair); vocab.add(pair)\ntokenize(text) by merged units',
    '中文按字起步、英文按子词；词表大小影响序列长度与未登录词率。'],
  'self-attention': [
    '由输入线性投影得到 Q、K、V|计算 QKᵀ/√d_k 并对每行 softmax|用注意力权重对 V 加权求和',
    'Q = XW_Q, K = XW_K, V = XW_V\nS = QKᵀ / √d_k\nA = softmax(S, dim=-1)   # 可加 causal mask\nO = A·V',
    '除以 √d_k 是为了防止 d_k 大时点积过大导致 softmax 饱和、梯度消失。'],
  'multi-head-attention': [
    '把 QKV 分别投影到 h 个子空间|每个头独立计算缩放点积注意力|拼接所有头输出再线性投影',
    'head_i = Attention(QW_i^Q, KW_i^K, VW_i^V)\nMHA = Concat(head_1, …, head_h)·W_O',
    '每头维度降为 d/h，总计算量与单头相当，但能并行关注不同位置/关系。'],
  'positional-encoding': [
    '为每个位置生成与维度相同的编码向量|加到 token embedding 上|注意力内积由此携带位置信息',
    'PE(pos, 2i)   = sin(pos / 10000^(2i/d))\nPE(pos, 2i+1) = cos(pos / 10000^(2i/d))\nX = Embedding + PE',
    '注意力本身是置换不变的，不加位置信息就完全丢失词序。'],
  'transformer-block': [
    '输入经多头自注意力得到上下文表示|残差连接 + 层归一化|前馈网络升维再降维，再做一次残差与归一化',
    'h = X + MHA(LN(X))        # Pre-LN\nout = h + FFN(LN(h))\nFFN(x) = W₂·GELU(W₁·x + b₁) + b₂',
    '张量形状全程保持 [batch, seq, d_model]；FFN 中间维度通常为 4d。'],
  'softmax-sampling': [
    '把 logits 除以温度 T|按 Top-k / Top-p 截断候选并过滤|重新归一化后按概率采样一个 token',
    'z = logits / T\ncand = top_k(z, k) or nucleus(z, p)\np = softmax(z[cand])\nnext = sample(cand, p)',
    'T→0 退化为贪心；Top-p 的候选数随分布自适应，通常比固定 Top-k 更自然。'],
  'beam-search': [
    '每步对每条存活序列展开所有可能 token|按累积对数概率打分|只保留分数最高的 k 条继续',
    'beams = [([bos], 0)]\nfor t = 1 .. T:\n  cands = expand(beams, V)\n  beams = top_k(cands, score / len^α)',
    '束宽越大越不易丢优解但更慢；长度惩罚 α 用来抵消短句天然高分。'],
  'kv-cache': [
    '生成第 1 个 token 时计算并缓存所有 K、V|后续每步只算新 token 的 Q/K/V|把新 K/V 追加到缓存后做注意力',
    '# 无缓存：每步重算 K = X_{1..t}W_K，总计算 O(n²)\n# 有缓存：K_t = x_t W_K; cache.append(K_t, V_t)\nA = q_t · [cache_K]ᵀ / √d',
    '用显存换计算：自回归总计算从 O(n³) 级降到 O(n²)，但长上下文缓存占用可观。'],
  'lora': [
    '冻结预训练权重 W|在旁路插入低秩矩阵 B·A|只训练 A、B，推理时可合并回 W',
    'h = W·x + (α/r)·B·A·x\nW ∈ R^{d×d} frozen\nA ∈ R^{r×d}, B ∈ R^{d×r}, r ≪ d',
    '可训练参数约为 2rd，相对 d² 常低于 1%；r 越大表达能力越强也越贵。'],
  'rlhf-dpo': [
    '收集同一提示的 chosen / rejected 偏好对|SFT 后训练奖励模型或直接构造偏好损失|更新策略使 chosen 相对 rejected 的概率差变大',
    '# DPO\nL = -log σ(β·[log π(y_w|x)/π_ref(y_w|x)\n             - log π(y_l|x)/π_ref(y_l|x)])',
    'DPO 省掉在线采样与奖励模型，但对偏好数据分布与 β 更敏感。'],
  'rag-vector-search': [
    '把查询与文档片段编码成向量|按余弦/内积检索 top-k 片段|拼接进上下文交给模型生成',
    'q = Encoder(query)\nidx = top_k(sim(q, d_i))\ncontext = join(docs[idx])\nanswer = LLM(context + query)',
    'top-k 太小漏信息、太大引入噪声并挤占上下文；重排常比单纯加 k 更有效。'],
  'moe-router': [
    '路由器为每个 token 计算各专家打分|取 top-k 个专家并归一化门控权重|加权汇总选中专家输出，统计负载',
    'g = softmax(W_r · x)\nI = top_k(g)\ny = Σ_{i∈I} (g_i/Σg_I)·E_i(x)',
    '参数量大但每 token 只算 k 个专家；负载不均需辅助损失与容量因子约束。'],
  'user-item-cf': [
    '由用户-物品评分矩阵计算用户或物品间相似度|选最相似的 k 个邻居|对邻居评分做相似度加权平均得预测分',
    'sim(u, v) = cosine(r_u, r_v)\nscore(u, i) = Σ_{v∈N(u)} sim(u,v)·r_{v,i} / Σ|sim|',
    'UserCF 偏社交/兴趣扩散，ItemCF 在物品数稳定时更稳定、可解释性更强。'],
  'matrix-factorization': [
    '把评分矩阵近似为 P·Qᵀ|对每条已知评分计算误差|用 SGD 更新对应用户与物品隐向量并加正则',
    'e = r_ui - p_u·q_i\np_u += η(e·q_i - λ·p_u)\nq_i += η(e·p_u - λ·q_i)',
    '隐维度 k 越大越容易过拟合；隐式反馈需引入置信度或负采样。'],
  'two-tower': [
    '用户塔与物品塔各自编码成同维度向量|用点积/余弦打分，负采样构造对比损失|离线建物品向量索引，在线近邻召回',
    'u = f_user(features_u); v = g_item(features_i)\ns = u·v / τ\nL = -log exp(s⁺)/Σ exp(s)',
    '两塔解耦使物品向量可离线预计算，是亿级候选在线召回的主流结构。'],
  'bandit-exploration': [
    '为每个臂维护收益均值估计|按策略选臂：随机试探 / 置信上界 / 后验采样|观察奖励并更新估计与累积遗憾',
    '# UCB\na_t = argmax_a [ μ̂_a + c·√(2 ln t / n_a) ]\n# Thompson\nθ_a ~ Beta(α_a, β_a); a_t = argmax θ_a',
    '累积遗憾衡量「没选最优臂」的损失；ε-greedy 简单但后悔值线性增长。'],
  'mmr-rerank': [
    '按相关性得到候选池|每步计算 λ·相关性 - (1-λ)·与已选最大相似度|选 MMR 最高者加入结果列表',
    'MMR(d) = λ·rel(q,d)\n        - (1-λ)·max_{s∈S} sim(d,s)\nS = S ∪ {argmax MMR}',
    'λ=1 退化为纯相关性排序；λ 过小会牺牲点击率换多样性。'],
  'ctr-funnel': [
    '从百万级候选池多路召回|粗排用轻量模型截断|精排预估 CTR/转化率，重排做多样性与规则干预',
    'pool → recall(10³) → pre-rank(10²)\n    → rank(CTR) → rerank(多样性/打散) → top-N',
    '每层的保留率决定效果与延迟；阈值变化会直接改变最终曝光分布。'],
  'backprop': [
    '前向传播逐层计算激活并缓存|在输出层求误差 δ₂=(y−t)·y(1−y)|把 δ₂ 乘回权重得隐层 δ₁，再按 δ·输入求梯度并更新',
    'δᴸ = (aᴸ−y) ⊙ σ′(zᴸ)\nδˡ = (Wˡ⁺¹)ᵀδˡ⁺¹ ⊙ σ′(zˡ)\n∂L/∂Wˡ = δˡ(aˡ⁻¹)ᵀ; Wˡ ← Wˡ − η·∂L/∂Wˡ',
    "隐层误差必须用更新前的 W₂；学习率过大时损失会震荡甚至发散。"],
  'cnn': [
    '确定输入、卷积核与步长/补零|窗口从左上滑动，逐元素相乘求和|把点积写入输出特征图对应位置',
    'O[i,j] = Σ_u Σ_v I[i·s+u, j·s+v] · K[u,v]\n输出尺寸 = ⌊(n+2p−k)/s⌋+1',
    '卷积核决定提取的特征类型；补零保边缘，步长过大可能漏掉局部模式。'],
  'bm25': [
    '统计查询词在语料中的文档频率并计算 IDF|对每个文档累加强度分：IDF × 词频饱和项 × 长度归一项|按总分降序得到相关性排序',
    'IDF(t) = ln(1 + (N−df+0.5)/(df+0.5))\nTF 项 = tf(k1+1)/(tf + k1(1−b+b·len/avgdl))',
    'k1 抑制超高词频的边际收益，b 惩罚长文档；两者是搜索排序最常调的两个超参。'],
  'image-cnn': [
    '把真实照片下采样成 16×16 灰度网格|卷积核逐行扫描提取边缘，ReLU 与最大池化后跨通道汇合成纹理|展平成 256 维向量，训练得到的分类头输出猫/狗/背景概率',
    'for l = 1 .. L:\n  H = ReLU(Conv3×3(H, K_l) + b_l)\n  H = MaxPool2×2(H)\nz = Flatten(H)\ny = Softmax(W·z + b)',
    '卷积核共享权重让参数量与图像大小解耦；池化带来平移容忍。卷积核是固定教学示例，分类头权重由真实照片特征图经 softmax 回归训练得到，类别概率完全由卷积特征算出。'],
  'text-transformer': [
    '按字切分中文句子并映射成词向量|每层多头注意力让 token 互相聚合信息，再经 FFN 与残差归一化|多层堆叠后平均池化，分类头输出情感概率',
    'X⁰ = Embed(tokens)\nfor l = 1 .. L:\n  A = Softmax(QKᵀ/√d)\n  X = LayerNorm(X + A·V)\n  X = LayerNorm(X + FFN(X))\ny = Softmax(W·MeanPool(Xᴸ))',
    '不同头关注不同关系（如「味道↔很好」）；层数增加提升抽象能力，但计算量随 L·n² 增长。'],
  'cat-cnn-features': [
    '把真实照片下采样成 16×16 灰度网格|第 1/2 层逐行扫描 3×3 卷积核，ReLU 后 2×2 最大池化，再跨通道加权汇合|第 3 层用猫照特征图上的部件模板滑动匹配，第 4 层汇总证据并分类',
    'H1 = ReLU(Conv3×3(I, K1))              # 边缘\nP1 = MaxPool2×2(H1); H2 = ReLU(Σch W·Conv3×3(P1, K2))\nH3[r,c] = NCC(H2 局部窗口, 部件模板)     # 耳/眼/鼻口\ny = Softmax(3·mean(H3) + 1.5·sim(I,原型) − 1.2·垂耳)',
    '完整步骤展示扫描位置、ReLU、池化与层间传递；特征在节点中逐级涌现：像素→边缘→纹理→部件→判定。输入来自真实照片，遮挡眼睛或耳朵会让对应节点和分类置信度一起下降。卷积核与模板是固定教学示例，真实 CNN 的滤波器从数据中学得。'],
  'cat-cnn-training': [
    '把真实照片加噪扩成小训练集，卷积核用固定种子随机初始化|每轮做前向传播算交叉熵损失，再反向传播把误差分摊到核权重和分类头|用 SGD 更新参数，重复多轮直到损失下降、准确率上升',
    'for ep = 1 .. E:\n  ŷ = Softmax(W·Pool(ReLU(ConvK(X))) + b)\n  L = −Σ y·log(ŷ)\n  K ← K − η·∂L/∂K;   W ← W − η·∂L/∂W',
    '这是真实训练而非预置示例：初始核是随机小数，分类接近瞎猜；随着反向传播，核里逐渐出现有方向的边缘模式，测试照片被正确分开。降低学习率或轮数会看到学不动——这正是超参的意义。网络很小、数据只有三张照片的带噪变体，目的是看清学习过程。'],
  'self-supervised-rotation': [
    '把每张真实照片分别旋转 0/90/180/270 度并加噪|标签直接取「旋转了多少度」，完全不用猫狗叶类别标注|CNN 预测角度，反向传播逼它学会边缘方向与纹理等通用特征',
    'for img in photos:\n  for ang in [0,1,2,3]:\n    x = rotate(img, ang·90°)   # 标签 = ang，自动生成\n    ŷ = CNN(x)\n    L = CrossEntropy(ŷ, ang);  SGD(θ − η·∂L/∂θ)',
    '自监督不是没有监督，而是把人工标签换成数据自身的结构：这里「转了多少度」天然可知。网络为猜对角度必须理解图像朝向与纹理，学到的特征不依赖类别标注，可直接迁移到下游任务——看面板右侧三类图特征相似度下降，说明它们已被分开。这就是预训练的直觉。'],
};

export const getDetail = (id) => {
  const d = DETAILS[id];
  if (!d) return null;
  return { steps: d[0].split('|'), pseudo: d[1], insight: d[2] };
};
