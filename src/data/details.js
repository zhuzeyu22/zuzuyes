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
  'fibonacci-recursion': [
    '定义 fib(n)=fib(n−1)+fib(n−2)|朴素递归会把同一个子问题反复展开|用数组缓存已算结果，命中则直接返回|也可自底向上用两个滚动变量替代整张表',
    'fib(n, memo):\n  if n <= 1: return n\n  if memo[n] exists: return memo[n]\n  memo[n] = fib(n-1, memo) + fib(n-2, memo)\n  return memo[n]',
    '朴素递归调用次数按 φⁿ 增长，记忆化后每个子问题只算一次、降到 O(n)；再滚动优化可把空间从 O(n) 降到 O(1)。演示里的「调用次数」包含缓存命中，关掉记忆化就能看到指数爆炸。'],
  'lcs': [
    '定义 dp[i][j] 为 A 前 i 个字符与 B 前 j 个字符的最长公共子序列长度|首行首列填 0|末尾字符相同取左上角加 1，否则取上方与左方较大值|从右下角回溯，相等则斜向上移并记录字符',
    'for i = 1 .. m:\n  for j = 1 .. n:\n    if A[i-1] == B[j-1]: dp[i][j] = dp[i-1][j-1] + 1\n    else: dp[i][j] = max(dp[i-1][j], dp[i][j-1])\n# 回溯：相等斜走，否则朝较大的方向走',
    '只求长度可把空间滚动到 O(min(m,n))；要还原序列则需完整表或分治。子序列不要求连续，这一点与子串不同；存在多个等长解时，回溯的取等方向决定输出哪一个。'],
  'hash-table': [
    '对键求哈希并映射到桶下标|桶内有冲突则按策略处理|负载因子超阈值时扩容重哈希',
    'i = hash(key) % m\n# 链地址: bucket[i].append((key, val))\n# 线性探测: while slot[i] occupied: i = (i+1) % m',
    '负载因子决定冲突率；线性探测有聚集问题，删除需墓碑标记。'],
  'lru-cache': [
    '查哈希表判断命中|命中则把节点移到链表头部|未命中则插入头节点，超容量淘汰尾节点',
    'get(k): if k in map: move_to_head(node); return node.v\nput(k, v):\n  if k in map: update; move_to_head\n  else: add_to_head; if size > cap: remove_tail()',
    '哈希表定位 + 双向链表保证 O(1) 删除，是缓存淘汰策略的面试常客。'],
  'union-find': [
    '初始化 parent[i]=i、rank[i]=0，每个元素各自成集合|find 沿父指针走到根，并把路径上的节点直接挂到根（路径压缩）|union 先找两根，按秩把矮树挂到高树下|秩相等时合并后根的秩加 1',
    'find(x):\n  if parent[x] != x: parent[x] = find(parent[x])\n  return parent[x]\nunion(a, b):\n  ra, rb = find(a), find(b)\n  if ra == rb: return\n  if rank[ra] < rank[rb]: swap(ra, rb)\n  parent[rb] = ra\n  if rank[ra] == rank[rb]: rank[ra]++',
    '只用路径压缩或只用按秩合并已足够高效；两者叠加后单次操作近似反阿克曼函数，实践中视为 O(1)。find 要先递归压缩再返回根，写反会破坏树结构。Kruskal 最小生成树靠它判环。'],
  'gradient-descent': [
    '计算当前参数处的损失梯度|沿负梯度方向按学习率更新|重复直到收敛或发散',
    'for t = 1 .. T:\n  g = ∇L(w)\n  v = μ·v - η·g      # 动量可选\n  w = w + v',
    '学习率过大直接发散；动量抑制震荡，Adam 进一步做逐参数自适应。'],
  'linear-regression': [
    '构造多项式特征矩阵 X|用最小二乘解 (XᵀX)⁻¹Xᵀy|在测试点上对比拟合误差',
    'w = (XᵀX + λI)⁻¹ Xᵀ y\ny_hat = X·w',
    '阶数升高会先降误差后急剧过拟合；正则化与交叉验证是控制手段。 演示默认使用真实数据集（diabetes，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'logistic-regression': [
    '线性打分 z = w·x|经 sigmoid 转成概率|用交叉熵梯度迭代更新并加正则',
    'p = σ(w·x + b)\nL = -[y·log p + (1-y)·log(1-p)] + λ||w||²\nw -= η·Xᵀ(p - y)',
    '输出是概率，需校准才可直接用于 CTR 出价；线性边界无法拟合环形数据。 演示默认使用真实数据集（breast，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'knn': [
    '计算查询点到所有训练样本的距离|取距离最小的 k 个邻居|按邻居标签多数投票或加权平均',
    'd_i = ||x - x_i||²\nidx = argsort(d)[:k]\nŷ = mode(y[idx])',
    'k 小则边界碎、易过拟合；k 大则边界平滑、欠拟合。特征必须标准化。 演示默认使用真实数据集（iris / wine / breast，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'kmeans': [
    '初始化 k 个质心|把每个点分配给最近质心（E 步）|重算各簇均值作为新质心（M 步）',
    'repeat:\n  c_i = argmin_k ||x_i - μ_k||²\n  μ_k = mean(x_i where c_i = k)\nuntil assignments unchanged',
    '目标函数单调下降但只保证局部最优；k 与初始化敏感，K-Means++ 可缓解。 演示默认使用真实数据集（iris / wine，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'dbscan': [
    '统计每个点 eps 邻域内的点数|邻域点数 ≥ minPts 标记为核心点|从核心点按密度可达扩张成簇',
    'for p in points:\n  if |N_eps(p)| >= minPts:\n    expand_cluster(p, N_eps(p))\nelse if not reachable: mark as noise',
    '无需预设簇数、能识别任意形状与噪声，但对 eps/minPts 和密度不均很敏感。 演示默认使用真实数据集（iris / wine，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'decision-tree': [
    '枚举所有特征与候选切分点|按基尼不纯度或信息增益选最优切分|递归划分直到达到停止条件',
    'split = argmax_{(f,t)} ΔGini(D, f, t)\nD_left, D_right = partition(D, split)\nbuild_tree(D_left); build_tree(D_right)',
    '深度、最小叶样本数、剪枝是控制过拟合的三个旋钮；树边界是轴平行的。 演示默认使用真实数据集（breast，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'svm': [
    '寻找最大化间隔的分离超平面|引入松弛变量允许少量错分|用核函数把样本映射到高维',
    'min ½||w||² + C·Σξ_i\ns.t. y_i(w·φ(x_i)+b) ≥ 1 - ξ_i',
    'C 越大越不容错、间隔越窄；只有支持向量影响最终边界。 演示默认使用真实数据集（breast，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
  'pca': [
    '中心化并计算协方差矩阵|求特征值与特征向量，按方差排序|取前 k 个主成分做投影',
    'X̃ = X - mean(X)\nC = X̃ᵀX̃ / n\neig(C) → [v₁…v_d], sort by λ\ndesc\nZ = X̃·V_k',
    '主成分是方差方向不是分类方向；投影前必须标准化量纲不同的特征。 演示默认使用真实数据集（iris / wine，UCI / scikit-learn / OpenML，CC BY 4.0），可在「数据来源」参数中切回合成数据对照。'],
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
  'embedding': [
    '把 token 编号映射为 0..V−1 的离散 id|准备一张 V×d 的可学习嵌入表|查表取出该 token 对应的 d 维行向量|把向量送入后续层，并用余弦相似度观察近邻',
    'ids = tokenize(text)                # token -> 0..V-1\nE = Embedding(V, d)                  # 可学习参数 V*d\nx_t = E[ids[t]]                      # 查表，O(d)\nsim(i, j) = cos(E[i], E[j])\nloss -> ∇E                           # 随模型一起训练',
    '查表成本是 O(d)，V·d 是参数量而非单次计算量。演示向量由固定种子生成，用来直观展示「相似词聚在一起」；真实语义来自上下文共现（Word2Vec）或语言模型反向传播。词表覆盖不到时出现未登录词，低频词的向量通常训练不充分。'],
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
  'multi-recall': [
    '同一 query 并行走协同、向量、热门、规则等多路通道|每路按各自口径产出 top-N 候选|按物品 id 合并并去重|用统一分数排序截断，再交给粗排与精排',
    'cand = {}\nfor ch in [cf, vec, hot, rule]:\n  cand[ch] = ch.retrieve(q, N)\nmerged = dedup(concat(cand.values()), key=item_id)\nranked = sort(merged, key=score)[:M]',
    '召回阶段先追覆盖率（Recall），排序阶段才追准确率；通道越多覆盖越好，但去重与延迟成本同步上升。演示里 relevant 集合固定，去不去重会直接改变召回率；各路分数需先归一化才可比，否则排序被某一路的量纲主导。'],
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
  'ann-search': [
    '离线把向量聚类成若干簇并记录簇中心|查询时先算到各中心的距离，选最近的 nprobe 个簇|只在被探测的簇内做精确距离排序|与暴力 top-k 对比召回率和扫描比例',
    '# 离线建索引\ncenters = KMeans(vectors, nc)\nfor v in vectors: cluster[v] = nearest_center(v)\n# 在线查询\nprobes = top_k_by_dist(q, centers, nprobe)\ncand = [v for v in vectors if cluster[v] in probes]\ntop = top_k_by_dist(q, cand, k)',
    '演示用的是 IVF 倒排文件索引：nprobe 是速度与召回的旋钮，调大召回上升、延迟也上升。索引只负责缩小候选集，最终排序仍是精确距离。PQ 用量化压缩存储、HNSW 用图遍历，是另外两条路线，本演示不涉及。'],
  'ndcg': [
    '为每个物品标注相关性 rel|用线性 rel 或指数 2^rel−1 换算增益|对排序前 K 位累加 gain/log2(位置+1) 得 DCG|按 rel 降序构造理想排序并算 IDCG|DCG 除以 IDCG 得到 NDCG@K',
    'gain(r) = 2^r - 1                    # 或线性 r\nDCG@K  = Σ_{i=1..K} gain(rel_i) / log2(i+1)\nIDCG@K = DCG@K(按 rel 降序的理想列表)\nNDCG@K = DCG@K / IDCG@K',
    '所有 rel 都为 0 时 IDCG=0，NDCG 无定义，实现里需约定返回 0。指数增益放大高相关结果排在前面的收益，是搜索与推荐的常用口径；NDCG@K 只评价前 K 位，不对长尾负责。'],
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

  // ── 全量补全：按 catalog 分类顺序（基础 → 数学） ──
  'shell-sort': [
    '选一组递减间隔序列（如 Knuth：1,4,13…）|对每个间隔 g，把下标模 g 相同的元素视为一组|每组内做插入排序|g 逐步缩小到 1，此时数组已近乎有序',
    'gaps = knuth_sequence(n)\nfor g in gaps:\n  for i = g .. n-1:\n    tmp = a[i]; j = i\n    while j >= g and a[j-g] > tmp:\n      a[j] = a[j-g]; j -= g\n    a[j] = tmp',
    'gap 序列决定性能，Knuth 序列约 O(n^1.3~n²)；最后一遍 g=1 保证完全有序。原地但不稳定，是插入排序的高效推广。'],
  'counting-sort': [
    '统计每个取值出现次数|对频次做前缀和得到各值的终止位置|从右向左扫描原数组，按值写入输出并递减位置|输出即稳定有序结果',
    'cnt[v]++ for v in a\nfor v = 1 .. k: cnt[v] += cnt[v-1]\nfor i = n-1 .. 0:\n  v = a[i]; out[cnt[v]-1] = v; cnt[v]--',
    '只在值域 k 较小时高效；从右向左写是保证稳定性的关键。值域很大时应改用比较排序。'],
  'radix-sort': [
    '从最低位开始|按当前位把元素稳定分进 0~9 号桶|按桶号顺序拼接回数组|位数递增重复，最高位处理后整体有序',
    'for d = 1 .. max_digits:\n  buckets = [[] for _ in 0..9]\n  for x in a: buckets[digit(x,d)].append(x)\n  a = concat(buckets)',
    '每轮必须稳定，这是从低位到高位成立的前提；复杂度 O(d(n+k))。负数需整体偏移后再排。'],
  'bucket-sort': [
    '按数值比例把元素放进 k 个桶|对每个桶内做插入排序|按桶号从小到大拼接|数据近似均匀时整体接近线性',
    'buckets = [[] for _ in 0..k-1]\nfor x in a: b = floor((x-lo)/(hi-lo)*k); buckets[b].append(x)\nfor b in buckets: insertion_sort(b)\nreturn concat(buckets)',
    '性能强依赖分布：所有元素落进同一个桶就退化成 O(n²)。桶很小时用插入排序最划算。'],
  'tim-sort': [
    '从左到右识别天然有序段，下降段直接反转|不足 minrun 的段用插入排序补齐|用栈维护段长，满足规则就两两归并|最后合并剩余段',
    'for run in identify_runs(a):\n  if descending(run): reverse(run)\n  if len(run) < minrun: extend_by_insertion(run, minrun)\n  push(run)\n  while mergeable(stack_top_two()): merge_top_two()\nmerge_remaining()',
    '利用真实数据中的局部有序性：最坏 O(n log n)、最好 O(n)，稳定。Python 与 Java 的对象数组排序都基于它。'],
  'linear-search': [
    '不要求数据有序|从下标 0 开始逐个与目标比较|相等则记录命中位置|继续扫完可找出所有匹配',
    'hits = []\nfor i = 0 .. n-1:\n  if a[i] == x: hits.append(i)\nreturn hits',
    'O(n) 且无需预处理；只需要第一个命中时可提前返回。演示默认找出全部位置，便于看清扫描过程。'],
  'interpolation-search': [
    '要求数组有序且近似均匀|按目标值相对两端的比例估算下标 pos|比较 a[pos] 与目标值|按大小收缩左/右边界后重复',
    'lo, hi = 0, n-1\nwhile lo <= hi and a[lo] <= x <= a[hi]:\n  pos = lo + (x-a[lo])*(hi-lo)/(a[hi]-a[lo])\n  if a[pos] < x: lo = pos+1\n  elif a[pos] > x: hi = pos-1\n  else: return pos',
    '均匀分布时平均 O(log log n)，偏斜数据可能退化到 O(n)；a[hi]==a[lo] 时会除零，需单独处理。'],
  'kmp': [
    '先为模式串构造 lps（最长相同真前后缀）|文本指针 i 与模式指针 j 从左到右比对|失配时 j 回退到 lps[j-1]，i 永不回退|j 走到模式长度即一次完整匹配',
    'lps = prefix_table(pat)\ni = j = 0\nwhile i < n:\n  if txt[i] == pat[j]: i++; j++\n  if j == m: found(i-j); j = lps[j-1]\n  elif i < n and txt[i] != pat[j]:\n    if j: j = lps[j-1]\n    else: i++',
    '文本指针不回退是 O(n+m) 的关键；lps 记录失配后能复用多少已匹配前缀，避免重复比较。'],
  'rabin-karp': [
    '为模式串和文本首个窗口计算滚动哈希|每右移一位用 O(1) 更新窗口哈希|哈希相等才逐字符确认|命中后继续找下一处',
    'hp = hash(pat); hw = hash(txt[0..m-1])\nfor i = 0 .. n-m:\n  if hw == hp and txt[i..i+m) == pat: found(i)\n  hw = (hw - txt[i]*B^(m-1))*B + txt[i+m]',
    '哈希碰撞会造成误报，所以必须二次验证；滚动更新让多模式匹配也能共享同一次扫描。'],
  'boyer-moore': [
    '把模式串与文本左对齐|从模式串右端向左逐字符比对|失配时按坏字符与好后缀规则决定跳距|右移模式串后继续，命中后找下一处',
    'i = 0\nwhile i <= n-m:\n  j = m-1\n  while j >= 0 and pat[j] == txt[i+j]: j--\n  if j < 0: found(i); i += 1\n  else: i += max(bad_char_shift, good_suffix_shift)',
    '跳距越大比较次数越少，最好情形可达 O(n/m)；代价是需要 O(m) 空间预处理跳转表。'],
  'manacher': [
    '在原串字符间插入分隔符，统一奇偶回文|维护当前最右回文的中心 c 与右边界|新位置从镜像下界开始扩展，跳过已知部分|按半径换算回原串的最长回文',
    's = "#" + join(chars with "#") + "#"\nfor i = 0 .. len(s)-1:\n  mirror = 2*c - i\n  r = min(right-i, p[mirror]) if i < right else 1\n  while s[i-r] == s[i+r]: r++\n  p[i] = r\n  if i+r > right: c = i; right = i+r',
    '对称性保证每个位置的扩展只会发生一次，总复杂度 O(n)；分隔符让偶长度回文复用同一套逻辑。'],
  'trie-match': [
    '把所有模式串逐字符插入一棵前缀树|从文本每个位置沿字符边向下走|走到结尾节点就输出一次匹配|无路可走则换下一个起点',
    'for p in patterns: insert(root, p)\nfor i = 0 .. n-1:\n  node = root\n  for j = i .. n-1:\n    if txt[j] not in node.next: break\n    node = node.next[txt[j]]\n    if node.end: found(i, j)',
    '多模式共享前缀，建一次树可反复查询；时间 O(n·L)，空间为全部模式字符总数。'],
  'karatsuba': [
    '把 x、y 各拆成高低两半|计算 z2=x1·y1 与 z0=x0·y0|再算 (x1+x0)(y1+y0)，减去 z2、z0 得中间项|按位权组合结果并递归',
    'karatsuba(x, y):\n  if small(x,y): return x*y\n  x1,x0 = split(x); y1,y0 = split(y)\n  z2 = karatsuba(x1,y1); z0 = karatsuba(x0,y0)\n  z1 = karatsuba(x1+x0, y1+y0) - z2 - z0\n  return z2*B^(2m) + z1*B^m + z0',
    '3 次半规模乘法替代 4 次，复杂度 O(n^1.585)；递归到小整数时直接用硬件乘法才划算。'],
  'closest-pair': [
    '按 x 坐标排序点集|递归求左右半区各自的最近距离 d|合并时只检查中线附近宽度 2d 的窄带|带内按 y 排序后每个点只比较有限个邻居',
    'pts = sort_by_x(P)\nd = min(closest(pts[:mid]), closest(pts[mid:]))\nstrip = [p for p in pts if abs(p.x-mid_x) < d]\nfor p in sort_by_y(strip):\n  for q in next_few(p, strip): d = min(d, dist(p,q))\nreturn d',
    '几何 packing 保证带内每点只需检查常数个邻居，所以合并是线性；不按 y 排序会退化。'],
  'activity-selection': [
    '按结束时间升序排序活动|每次选开始时间不早于上一个已选活动结束时间的活动|更新最近结束时间|扫完得到最大兼容活动集',
    'sort(acts, key=end)\nselected = []; last_end = -∞\nfor a in acts:\n  if a.start >= last_end:\n    selected.append(a); last_end = a.end',
    '区间调度中「最早结束」贪心是最优的；改成按开始时间或时长排序就不再保证最优。'],
  'fractional-knapsack': [
    '计算每件物品的单位价值 v/w|按单位价值降序排序|依次整件装进背包|装不下时按比例切分最后一件',
    'items.sort(key=lambda x: x.v/x.w, reverse=True)\nfor it in items:\n  take = min(it.w, W)\n  value += take * it.v/it.w\n  W -= take\n  if W == 0: break',
    '可分割时贪心即最优；01 背包不可切分，贪心不成立——这是两者的分水岭。'],
  'huffman-coding': [
    '把每个符号看作单节点树放入最小堆|反复取出频次最小的两棵树合并|新树频次为二者之和并重新入堆|最后剩一棵树，左枝记 0 右枝记 1',
    'heap = [(freq[c], node(c)) for c]\nwhile len(heap) > 1:\n  a = pop_min(); b = pop_min()\n  push((a.freq+b.freq, Node(a,b)))\ncodes = traverse(root, prefix="")',
    '带权路径长度最小，高频符号码更短；生成的是前缀码，可无歧义解码。堆让每轮合并为 O(log n)。'],
  'lis': [
    'tails[k] 保存长度 k+1 的递增子序列的最小结尾|对每个 x 用二分找 tails 中第一个 ≥ x 的位置|替换该位置，若 x 更大则追加|最终 tails 长度即 LIS 长度',
    'tails = []\nfor x in a:\n  i = lower_bound(tails, x)\n  if i == len(tails): tails.append(x)\n  else: tails[i] = x\nreturn len(tails)',
    'tails 只是「最小结尾」摘要，本身未必是真实子序列；严格递增用 lower_bound，非递减用 upper_bound。'],
  'edit-distance': [
    'dp[i][j] 表示 A 前 i 字符变成 B 前 j 字符的最小代价|首行首列初始化为删除/插入次数|字符相等取左上角，否则取删除、插入、替换三者最小加 1|右下角即答案',
    'dp[0][j] = j; dp[i][0] = i\nfor i = 1 .. m:\n  for j = 1 .. n:\n    if A[i-1] == B[j-1]: dp[i][j] = dp[i-1][j-1]\n    else: dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])',
    '三种操作对应上、左、左上三个方向；空间可滚动到 O(min(m,n))，但要输出具体编辑脚本仍需回溯。'],
  'coin-change': [
    'dp[j] 表示凑出金额 j 的最少硬币数|初始化 dp[0]=0、其余为无穷|外层枚举硬币、内层升序枚举金额|每个金额取「不用 / 用」该硬币的较小值',
    'dp[0] = 0; dp[1..W] = ∞\nfor c in coins:\n  for j = c .. W:\n    dp[j] = min(dp[j], dp[j-c] + 1)',
    '求最少硬币数时硬币必须在外层（完全背包，可重复使用）；求组合数时改为累加，顺序颠倒会得到排列数。'],
  'matrix-chain': [
    '按链长递增枚举区间 [i,j]|对每个分割点 k 计算左代价 + 右代价 + 三次矩阵标量乘法次数|取最小值并记录最优 k|链长达到 n 时得到全局最优',
    'for len = 2 .. n:\n  for i = 1 .. n-len+1:\n    j = i+len-1; dp[i][j] = ∞\n    for k = i .. j-1:\n      cost = dp[i][k]+dp[k+1][j]+p[i-1]*p[k]*p[j]\n      if cost < dp[i][j]: dp[i][j] = cost',
    '按链长枚举保证子问题先算好；加括号只改变乘法顺序，不改变最终矩阵。'],
  'permutation': [
    '递归固定第 pos 位|让后面每个元素轮流交换到该位|递归处理下一位|回到上一层时撤销交换，保证不重不漏',
    'dfs(pos):\n  if pos == n: record(a); return\n  for i = pos .. n-1:\n    swap(a[pos], a[i]); dfs(pos+1); swap(a[pos], a[i])',
    '递归树有 n! 个叶子，无法避免指数级；交换加撤销是原地生成排列的标准写法。'],
  'subset-sum': [
    '对每个元素做选 / 不选的二叉决策|用后缀和判断剩余全选是否够到目标|当前和已超过目标则剪枝|递归到末尾命中目标即记录',
    'dfs(i, cur):\n  if cur == target: record()\n  if i == n or cur + suffix[i] < target: return\n  dfs(i+1, cur)\n  if cur + a[i] <= target: dfs(i+1, cur+a[i])',
    '剪枝只砍掉无效分支，最坏仍是 O(2^n)；目标和较小时 DP 版本 O(n·target) 更优。'],
  'sudoku-solver': [
    '用行、列、宫三个集合维护已用数字|每次选候选数最少的空格（MRV）|逐个数填入并更新约束后递归|走不通就撤销并尝试下一个候选',
    'dfs():\n  cell = argmin_candidates(empty_cells)\n  if none: return true\n  for v in candidates(cell):\n    place(cell, v)\n    if dfs(): return true\n    remove(cell, v)\n  return false',
    'MRV 显著收窄搜索树；约束传播（填入即更新候选集）比每步全盘扫描快得多。'],
  'array-list': [
    '维护连续数组与 capacity / size|尾部追加时容量够就直接写入|容量不足则申请更大的 backing array 并复制旧元素|写入新值并更新 size',
    'append(x):\n  if size == cap: resize(2*cap)\n  data[size] = x; size++\nresize(new_cap):\n  b = new_array(new_cap); copy(b, data, size); data = b',
    '随机访问 O(1)、尾部追加均摊 O(1)，但中间插入删除要搬移 O(n) 个元素；扩容倍数太小会导致频繁复制。'],
  'linked-list': [
    '节点靠 next 指针串联|表头插入只需改新节点与 head|按位置查找需从头沿指针遍历|删除时把前驱的 next 接到后继',
    'insert_head(x): x.next = head; head = x\nfind(i): cur = head; for k = 0 .. i-1: cur = cur.next\n  return cur\ndelete(prev, cur): prev.next = cur.next',
    '插入删除本身 O(1)，但定位前驱通常 O(n)；缓存局部性差，实际访问速度常慢于数组。'],
  'stack': [
    '用数组或链表维护栈顶指针|入栈把元素压到 top|出栈只能从 top 弹出|空栈操作需先判空',
    'push(x): top++; data[top] = x\npop(): if empty: error; x = data[top]; top--; return x\npeek(): return data[top]',
    '后进先出（LIFO）。函数调用、括号匹配、表达式求值与 DFS 都依赖它；用数组尾部实现最省事。'],
  'queue': [
    '用循环数组或链表维护队头与队尾|入队从队尾追加|出队从队头取走|head 追上 tail 即为空',
    'enqueue(x): data[tail] = x; tail = (tail+1) % cap\ndequeue(): x = data[head]; head = (head+1) % cap; return x\nempty(): head == tail',
    '先进先出（FIFO），是 BFS 与任务缓冲的基础；用普通数组出队会整体搬移，循环队列避免这一点。'],
  'deque': [
    '维护首尾两个指针|支持 pushFront / pushBack / popFront / popBack 四种操作|用循环数组时两端都要取模|滑动窗口单调队列建立在它之上',
    'push_front(x): head=(head-1)%cap; data[head]=x\npush_back(x): data[tail]=x; tail=(tail+1)%cap\npop_front(): x=data[head]; head=(head+1)%cap; return x\npop_back(): tail=(tail-1)%cap; return data[tail]',
    '四种操作都是 O(1)。单调队列必须两端可操作，才能从尾部淘汰旧元素、从头部弹出窗口外元素。'],
  'binary-heap': [
    '用数组表示完全二叉树，下标 i 的孩子为 2i+1 与 2i+2|插入放到末尾再向上与父节点交换|删除堆顶时把末尾搬到根再向下与孩子交换|始终维持父节点不小于子节点',
    'push(x): data.push(x); sift_up(size-1)\npop(): top=data[0]; data[0]=data.pop(); sift_down(0); return top\nsift_up(i): while i>0 and data[i]>data[(i-1)//2]: swap(i,parent); i=parent',
    '优先队列的标准实现：插入与删除堆顶 O(log n)、建堆 O(n)。数组下标关系比指针更省空间。'],
  'bst': [
    '保证左子树 < 根 < 右子树|插入与查询都沿比较路径下降|删除需分叶节点、单孩子、双孩子用后继替换三种情况|中序遍历得到有序序列',
    'insert(node, x):\n  if node == null: return Node(x)\n  if x < node.val: node.left = insert(node.left, x)\n  else: node.right = insert(node.right, x)\nfind(node, x): while node: ...compare and descend...',
    '平衡时 O(log n)，有序插入退化成链会跌到 O(n)；中序有序是它最重要的性质。'],
  'avl-tree': [
    '在 BST 基础上为每个节点维护高度|插入删除后沿路更新高度并计算平衡因子|失衡时按 LL / LR / RR / RL 四种情形旋转|旋转后子树高度恢复,继续向上检查',
    'balance(node):\n  update_height(node); bf = height(left)-height(right)\n  if bf > 1:\n    if bf(left)<0: rotate_left(node.left)\n    return rotate_right(node)\n  if bf < -1:\n    if bf(right)>0: rotate_right(node.right)\n    return rotate_left(node)\n  return node',
    '严格平衡（左右高度差 ≤ 1）保证树高 O(log n)：查询略快于红黑树，但插入删除的旋转更多。'],
  'red-black-tree': [
    '每个节点标红或黑，根与 NIL 叶为黑|红节点不能有红孩子|从任一节点到叶的路径黑高相同|插入红色节点后靠变色与旋转修复约束',
    'insert(node):\n  bst_insert(node as red)\n  while parent is red:\n    if uncle is red: recolor(parent, uncle, grandparent)\n    else: rotate_and_recolor()\n  root.color = black',
    '最长路径不超过最短路径两倍，树高 O(log n)；变色多于旋转，适合频繁增删，Java TreeMap 底层就是它。'],
  'b-tree': [
    '每个节点可存多个键和多个孩子|插入先定位到叶子|键数超上限就把中间键上提到父节点并分裂|树高远低于二叉平衡树',
    'insert(node, k):\n  leaf = locate(node, k)\n  leaf.keys.add(k); sort(leaf.keys)\n  if len(leaf.keys) > 2t-1:\n    mid = split(leaf); promote(mid.key, mid.left, mid.right)',
    '多路分支降低树高、减少磁盘 IO；数据库索引常用 B+ 树，把数据都放在叶子层以支持范围扫描。'],
  'trie': [
    '把公共前缀合并为同一条路径|插入时按字符逐层建节点，结尾打标记|前缀查询沿字符路径走一遍|无路可走说明前缀不存在',
    'insert(word):\n  node = root\n  for ch in word:\n    if ch not in node.next: node.next[ch] = Node()\n    node = node.next[ch]\n  node.end = true\nsearch(prefix): walk down; return node != null',
    '查询只与串长 L 有关、与词表大小无关，但空间是全部字符总数；工程上常用压缩前缀树减少节点。'],
  'skip-list': [
    '在有序链表上叠加多层随机索引|搜索从顶层头节点开始|当前层能向右走就走，走不动就下降一层|到底层后即为目标位置',
    'search(x):\n  cur = top_head\n  for level = top .. 0:\n    while cur.next[level] and cur.next[level].val < x:\n      cur = cur.next[level]\n  return cur.next[0]\ninsert(x): search; random_height; splice every level',
    '期望 O(log n)。随机层数代替严格平衡，实现比红黑树简单得多，Redis ZSET 的底层就是它。'],
  'bloom-filter': [
    '用 k 个哈希函数把元素映射到位数组|插入时把对应的 k 个位置 1|查询若任一位为 0 则一定不存在|全为 1 则判定可能存在',
    'add(x): for i = 1 .. k: bits[h_i(x) % m] = 1\nmight_contain(x):\n  for i = 1 .. k: if bits[h_i(x) % m] == 0: return false\n  return true',
    '不会误判否定，但会误判肯定；位数组越大、哈希越多误判率越低。普通布隆不支持删除，可用计数版本。'],
  'segment-tree': [
    '把数组递归折成区间树|每个节点保存该区间的聚合值|区间查询只访问 O(log n) 个覆盖节点|单点修改沿叶子到根更新路径',
    'build(l,r): tree[node] = merge(build(l,mid), build(mid+1,r))\nquery(node,l,r,ql,qr):\n  if cover: return tree[node]\n  return merge(query(left), query(right))\nupdate(node,l,r,pos,v): if leaf set; else recurse and pull_up',
    '区间查询与单点修改都是 O(log n)；区间批量修改需要懒标记延迟下传，否则会退化。'],
  'fenwick-tree': [
    '用 lowbit(i)=i&-i 定义每个节点覆盖的区间|单点更新沿 i+=lowbit(i) 向上累加|前缀和沿 i-=lowbit(i) 向下汇总|区间和由两个前缀和相减得到',
    'add(i, delta): while i <= n: bit[i] += delta; i += i & -i\nsum(i): s=0; while i>0: s += bit[i]; i -= i & -i; return s\nrange(l,r): sum(r) - sum(l-1)',
    '比线段树短、常数更小，但擅长的是可差分前缀聚合；任意区间最值需要另做改造。'],
  'suffix-array': [
    '把字符串的所有后缀按字典序排序|排序后拥有相同前缀的后缀彼此相邻|构造高度数组记录相邻后缀的最长公共前缀|用二分加 LCP 快速完成子串匹配',
    'sa = sort(suffixes(s))       # 实际用倍增达 O(n log n)\nrank[sa[i]] = i\nfor i = 0 .. n-1:\n  height[rank[i]] = lcp(s[i..], s[sa[rank[i]-1]..]) if rank[i]>0 else 0',
    '是后缀树的空间紧凑替代；高度数组把「某子串出现几次」变成连续区间统计。'],
  'consistent-hashing': [
    '把节点与键映射到同一个哈希环|键顺时针找到遇到的第一个节点|扩容只迁移新节点与后继之间的键|用虚拟节点让分布更均匀',
    'ring = sorted(hash(node_id) for node in nodes)   # 每节点多个虚拟节点\nlocate(key): h=hash(key); return first ring_node >= h (wrap)\nadd_node(id): insert virtual positions; migrate keys in (prev, id]',
    '扩缩容只迁移约 K/N 的键，远优于取模哈希；虚拟节点越多分布越均匀，但元数据也越多。'],
  'dfs': [
    '从起点沿一条路走到底|用访问标记避免重复进入|无路可走时回溯到上一层|记录发现序与回边可进一步判环',
    'dfs(u):\n  visited[u] = true\n  for v in adj[u]:\n    if not visited[v]: dfs(v)\n    else: record_back_edge(u,v)',
    '时间 O(V+E)；递归深度可能达到 V，工程上可改显式栈。DFS 序是拓扑排序与 Tarjan 的基础。'],
  'topological-sort': [
    '统计每个节点入度|把入度为 0 的节点入队|弹出节点并记录，删其出边让后继入度减一|新变 0 的节点继续入队',
    'indeg = compute()\nq = [v for v in V if indeg[v]==0]\nwhile q:\n  u = q.pop(); order.append(u)\n  for v in adj[u]: indeg[v]--; if indeg[v]==0: q.push(v)',
    '只适用于 DAG；若结果长度小于 V 说明存在环。同一个 DAG 通常有多个合法拓扑序。'],
  'bellman-ford': [
    'dist[s]=0，其余置无穷|对所有边做 V-1 轮松弛|每轮用 dist[u]+w 尝试更新 dist[v]|第 V 轮仍能松弛则存在负环',
    'dist[s] = 0\nfor i = 1 .. V-1:\n  for (u,v,w) in edges:\n    if dist[u]+w < dist[v]: dist[v] = dist[u]+w\nfor (u,v,w) in edges:\n  if dist[u]+w < dist[v]: negative_cycle()',
    '少数能直接处理负权边的单源最短路算法，O(VE) 较慢；没有负权边时优先用 Dijkstra。'],
  'spfa': [
    '维护待松弛节点的队列|弹出节点后遍历其出边尝试松弛|只有松弛成功且后继不在队中才重新入队|队列空即收敛',
    'q = [s]; inq[s] = true\nwhile q:\n  u = q.pop(); inq[u] = false\n  for (v,w) in adj[u]:\n    if dist[u]+w < dist[v]:\n      dist[v] = dist[u]+w\n      if not inq[v]: q.push(v); inq[v] = true',
    '平均比 Bellman-Ford 快，但最坏仍是指数级；统计节点入队次数可检测负环。'],
  'floyd-warshall': [
    'dist[i][j] 初始化为邻接矩阵|枚举中转点 k|对每对 i、j 检查 dist[i][k]+dist[k][j] 是否更短|更新矩阵，k 必须放最外层',
    'for k = 1 .. V:\n  for i = 1 .. V:\n    for j = 1 .. V:\n      if dist[i][k]+dist[k][j] < dist[i][j]:\n        dist[i][j] = dist[i][k]+dist[k][j]',
    '一次运行得到全源最短路，O(V³)。中转点放外层是区间 DP 的枚举顺序，放错会漏解。'],
  'astar': [
    '为每个节点算 g（已走代价）与 h（到终点估价）|按 f=g+h 最小的节点扩展|用优先队列维护开放集并记录前驱|h 可采纳（不高估）时保证最优',
    'open = {s with f=h(s)}\nwhile open:\n  u = pop_min_f(open)\n  if u == goal: return path\n  for v in adj[u]:\n    g_new = g[u] + cost(u,v)\n    if g_new < g[v]: g[v]=g_new; f[v]=g_new+h(v); push(v)',
    'h=0 时退化为 Dijkstra；h 越准扩展越少，但高估会丢最优解。网格上常用曼哈顿距离。'],
  'kruskal': [
    '所有边按权值升序排序|用并查集检查一条边两端是否已连通|不连通就加入生成树并合并集合|连通则跳过以避免成环',
    'sort(edges, key=w)\nuf = UnionFind(V)\nfor e in edges:\n  if uf.find(e.u) != uf.find(e.v):\n    tree.add(e); uf.union(e.u, e.v)',
    'O(E log E) 主要花在排序；并查集让判环近似 O(1)，是贪心策略正确的经典例子。'],
  'prim': [
    '从起点出发维护已连集合 S|每次取一条连接 S 与外部的最小权边|把外部端点并入 S 并更新候选边|直到所有节点都进入 S',
    'S = {0}; pq = edges_from(0)\nwhile pq:\n  e = pq.pop_min()\n  if e.v in S: continue\n  tree.add(e); S.add(e.v); pq.extend(edges_from(e.v))',
    '稠密图用邻接矩阵 O(V²)，稀疏图用堆 O(E log V)；与 Kruskal 都得到 MST，但生长路径不同。'],
  'tarjan-scc': [
    'DFS 时为每个节点分配 dfn 与 low|用栈保存尚未归属分量的节点|回溯时用孩子的 low 更新父节点 low|low==dfn 时把栈中节点弹出，组成一个强连通分量',
    'dfs(u):\n  dfn[u]=low[u]=++time; push(stack,u)\n  for v in adj[u]:\n    if dfn[v]==0: dfs(v); low[u]=min(low[u],low[v])\n    elif in_stack[v]: low[u]=min(low[u],dfn[v])\n  if low[u]==dfn[u]: pop until u into one SCC',
    '一次 DFS 找出全部强连通分量，O(V+E)；low 表示经回边能到达的最早祖先。'],
  'bipartite-matching': [
    '从每个左侧节点出发做 DFS 寻找增广路|遇到未匹配的右侧节点即告成功|沿递归路径翻转匹配状态|所有左侧点都尝试完得到最大匹配',
    'dfs(u):\n  for v in adj[u]:\n    if visited[v]: continue\n    visited[v] = true\n    if match[v] == -1 or dfs(match[v]): match[v] = u; return true\n  return false\nfor u in left: reset visited; if dfs(u): matching++',
    '增广路是匹配数能加一的充要条件。匈牙利算法 O(VE)，稠密图可用 Hopcroft-Karp 加速到 O(E√V)。'],
  'max-flow-dinic': [
    '用 BFS 在残余图上按距离给节点分层|DFS 只沿层次前进，用当前弧跳过已饱和边|反复推流直到本层无法增广|重复建层直到汇点不可达',
    'while bfs_level(s,t):\n  cur = copy_of(head)\n  while pushed = dfs(s, INF): flow += pushed\n# 无增广路后残余图可达集与其余节点之间即最小割',
    '当前弧优化避免重复扫描无效边；最大流等于最小割，这个对偶正是 graph-cut 的理论基础。'],
  'graph-cut': [
    '把每个像素或节点建成图节点|数据项把节点连向源或汇，容量表示归属代价|相邻节点之间连边，容量表示相似度|求最大流得到最小割，残余可达集即一类分割',
    'for p: add_edge(S,p,D_cost(p,fg)); add_edge(p,T,D_cost(p,bg))\nfor (p,q): cap=similarity(p,q); add_edge(p,q,cap); add_edge(q,p,cap)\nlabel(p) = fg if p in S_reachable_after_maxflow else bg',
    '相似度越强的相邻像素越难被切开；最大流算法的效率决定了可处理图像的规模。'],
  'naive-bayes': [
    '统计每个类别的先验概率|统计每个词在各条件下的似然并加拉普拉斯平滑|对查询文档逐词累加对数似然|取后验得分最大的类别',
    'P(c) = count(c)/N\nP(w|c) = (count(w,c)+1)/(count(c)+V)\nscore(c) = log P(c) + Σ_{w in doc} log P(w|c)\nreturn argmax_c score(c)',
    '条件独立假设很强，但文本分类效果出奇地好；用对数避免概率连乘下溢，平滑防止未见过词把概率直接变成 0。'],
  'random-forest': [
    '对每棵树做 Bootstrap 有放回采样|每个节点分裂时只随机考察一部分特征|树一直长成不做剪枝|所有树的输出投票或平均',
    'for t = 1 .. T:\n  D_t = bootstrap_sample(D)\n  tree_t = grow(D_t, split_features=sqrt(d))\npredict(x): vote_or_mean(tree_t(x) for t)',
    'Bagging 加随机特征让树之间去相关，主要降低方差；袋外（OOB）样本可给出近似无偏的误差估计。'],
  'adaboost': [
    '初始化所有样本权重相等|每轮找加权错误率最低的决策桩|按错误率计算弱分类器权重 α|放大错分样本权重进入下一轮，最后加权投票',
    'w_i = 1/N\nfor t = 1 .. T:\n  h_t = argmin weighted_error(D, w)\n  ε_t = Σ w_i [h_t(x_i) != y_i]\n  α_t = 0.5*ln((1-ε_t)/ε_t)\n  w_i *= exp(-α_t*y_i*h_t(x_i)); normalize(w)\nH(x) = sign(Σ α_t*h_t(x))',
    '关注难例是核心机制；对噪声和异常值敏感，因为错分样本的权重会被不断放大。'],
  'xgboost': [
    '用类别概率或均值作为初始预测|每轮计算一阶梯度 g 与二阶梯度 h|用带 λ、γ 正则的分裂增益选特征与切分点|生成深度受限的树，乘学习率 η 后累加',
    'F0 = prior\nfor m = 1 .. M:\n  g_i = ∂L(y_i,F(x_i)); h_i = ∂²L\n  gain = 0.5*(G_L²/(H_L+λ)+G_R²/(H_R+λ)-G²/(H+λ)) - γ\n  tree_m = fit(g,h); F += η*tree_m',
    '二阶近似让分裂增益更准，正则与列采样抑制过拟合；平方损失下 h 恒为 1，退化为普通梯度。'],
  'lightgbm': [
    '把连续特征离散成有限个直方图桶|基于梯度统计在桶边界上计算分裂增益|选增益最大的叶子做 leaf-wise 生长|配合 GOSS 与 EFB 减少样本和特征',
    'bin continuous features into histograms\nfor leaf with largest gain:\n  for feature, for bin boundary:\n    gain = (G_L²/H_L + G_R²/H_R - G²/H)/2\n  split at best boundary; push children',
    '直方图把分裂候选从 n 个降到桶数，训练快、内存省；leaf-wise 更易过拟合，必须限制最大叶子数。'],
  'hierarchical-clustering': [
    '把每个点当作初始簇|每步找出距离最近的两个簇并合并|按选定的链接方式更新簇间距离|重复到合成一簇，树状图记录每次合并高度',
    'clusters = [{p} for p in points]\nwhile len(clusters) > 1:\n  (a,b) = argmin linkage(dist, clusters)\n  merge(a,b); record height\n  update distances to new cluster',
    '无需预设 k，切树状图即可选粒度；朴素实现 O(n³) 只适合中等规模，单/全/平均链接结果差别很大。'],
  'gmm-em': [
    '初始化 k 个高斯分量的均值、方差与权重|E 步按当前参数计算每个样本对各分量的责任概率|M 步用责任加权重算三个参数|重复直到对数似然收敛',
    'init(π_k, μ_k, Σ_k)\nrepeat:\n  γ_ik = π_k*N(x_i|μ_k,Σ_k) / Σ_j π_j*N(x_i|μ_j,Σ_j)\n  π_k = mean_i(γ_ik)\n  μ_k = Σ_i γ_ik*x_i / Σ_i γ_ik\nuntil log_likelihood converges',
    '对数似然单调不减，但只保证局部最优；对初始化敏感，常用 K-Means 结果预热。演示向量由固定种子生成。'],
  'lda': [
    '计算类内散度 S_W 与类间散度 S_B|求 S_W⁻¹S_B 的特征向量|取最大的若干特征向量作为投影轴|把样本投影到低维空间使类均值尽量分开',
    'S_W = Σ_c Σ_{x in c} (x-μ_c)(x-μ_c)ᵀ\nS_B = Σ_c n_c (μ_c-μ)(μ_c-μ)ᵀ\nW = top_eigenvectors(S_W⁻¹ S_B, d\')\nZ = X·W',
    '是监督式降维（必须用标签），与无监督 PCA 目的不同；S_W 奇异时需加正则或先降维。'],
  'tsne': [
    '在高维按距离构造邻域概率 P，带宽由困惑度标定|在低维用 t 分布构造相似度 Q|用梯度下降最小化 KL(P‖Q)|得到适合可视化的二维嵌入',
    'P_ij ∝ exp(-||x_i-x_j||²/(2σ_i²)) with perplexity(P_i)=perpl\nQ_ij ∝ (1+||y_i-y_j||²)⁻¹\nL = KL(P||Q) = Σ P_ij*log(P_ij/Q_ij)\ny -= η·∂L/∂y',
    't 分布的长尾缓解高维降二维的「拥挤问题」；局部结构可信，但簇间距离和全局尺度不应过度解读。'],
  'association-rules': [
    '扫描事务统计每个项集的支持度|筛出满足最小支持度的一维频繁项|逐层连接生成候选并用「频繁项子集必频繁」剪枝|从频繁项集生成满足最小置信度的规则',
    'F1 = items with support >= minsup\nfor k = 2 .. while Fk not empty:\n  Ck = join(F_{k-1}, F_{k-1}); prune by subsets\n  Fk = c in Ck with support >= minsup\nrules = {A->B from Fk if support(A∪B)/support(A) >= minconf}',
    'Apriori 用反单调性剪枝，但逐层扫描仍昂贵；事务量大时改用 FP-Growth。'],
  'anomaly-isolation-forest': [
    '每棵树随机选特征与切分点|递归切分直到样本被孤立成单点|统计每个样本跨树的平均路径长度|路径越短越异常，归一化后得到异常分数',
    'for t = 1 .. T: tree_t = grow_random_partition(D_sub)\npath(x) = mean depth of x across trees\ns(x) = 2^(-mean_path(x)/c(n))\nc(n) = 2*H(n-1) - 2*(n-1)/n',
    '异常点更容易被少数几次切分孤立，因此路径短；无需标注、近似线性时间，但对局部密度异常不敏感。'],
  'calibration': [
    '把预测分按区间分箱|计算每箱真实正例率与平均预测概率|画可靠性曲线观察偏离程度|用 Platt 缩放或保序回归把分数映射成概率',
    'bins = split_by_score(preds)\nfor b in bins: emp[b]=mean(y in b); avg[b]=mean(pred in b)\n# Platt 缩放\nq = sigmoid(a*logit(p)+b) fitted by MLE\n# 或 isotonic regression 拟合 emp 与 avg',
    'AUC 高不代表概率准；CTR 出价与风险评估必须校准。保序回归非参数但易过拟合，Platt 更平滑。'],
  'perceptron': [
    '计算线性打分 z=w·x+b|用阶跃函数判定类别|分类正确不动，分错就按规则更新权重|重复遍历训练集直到收敛或达到迭代上限',
    'for epoch:\n  for (x,y) in D:\n    if y*(w·x+b) <= 0:\n      w += η*y*x\n      b += η*y',
    '线性可分保证收敛；不可分时会永远震荡，需 Pocket 算法或改用 SVM。它是神经网络与 SVM 的共同起点。'],
  'sgd-momentum': [
    '计算当前小批量上的梯度|用速度 v 累积历史梯度（指数滑动平均）|参数沿速度方向更新|震荡方向相互抵消，平坦方向持续加速',
    'v = β*v - η*∇L(w)\nw = w + v',
    'β 常取 0.9。动量帮助越过窄谷和鞍点，但也可能冲过极小值，可配合 Nesterov 提前量修正。'],
  'adam': [
    '维护梯度的一阶矩 m 与二阶矩 v|分别对两者做指数滑动平均|对初始偏置做偏差校正|按校正后比值逐参数缩放步长',
    'm = β1*m + (1-β1)*g\nv = β2*v + (1-β2)*g²\nm̂ = m/(1-β1^t); v̂ = v/(1-β2^t)\nw -= α*m̂/(√v̂+ε)',
    '稀疏特征的参数会获得更大步长；默认 β1=0.9、β2=0.999。后期学习率衰减仍重要，AdamW 修正了权重衰减耦合。'],
  'batch-norm': [
    '在每个 batch 内计算激活的均值与方差|把激活标准化到 0 均值 1 方差|用可学习的 γ、β 缩放平移|推理时改用训练期统计量的滑动平均',
    'μ_B = mean(x_B); σ_B² = var(x_B)\nx̂ = (x-μ_B)/√(σ_B²+ε)\ny = γ*x̂ + β\nrunning_mean = m*running_mean + (1-m)*μ_B',
    '缓解内部协变量偏移、允许更大学习率；依赖 batch 大小，小 batch 或 RNN 中效果明显变差。'],
  'layer-norm': [
    '对单条样本自己的全部特征计算均值与方差|用该样本的统计量标准化|再做 γ、β 缩放平移|不跨 batch，训练与推理行为一致',
    'μ = mean over features of x_i; σ² = var(...)\nx̂ = (x-μ)/√(σ²+ε)\ny = γ*x̂ + β',
    '不依赖 batch，适合变长序列与小 batch；Transformer 普遍采用 Pre-LN 结构。'],
  'dropout': [
    '每次迭代按概率 p 随机屏蔽一部分神经元|只用存活单元做前向与反向传播|推理时打开全部单元并按 1/(1-p) 缩放|整体等价于对多个子网络做隐式集成',
    'mask = bernoulli(1-p)\ny = (x * mask) / (1-p)      # 训练时 inverted dropout\n# 推理阶段 mask 全为 1',
    '抑制神经元之间的共适应，近似正则化；p 过大（超过 0.5）容易欠拟合。'],
  'rnn': [
    '把隐藏状态沿时间步向后传递|每步用同一组权重把当前输入与上一步状态合成新状态|输出由当前隐藏状态产生|反向传播沿时间展开形成很长的梯度链',
    'h_t = tanh(W_x*x_t + W_h*h_{t-1} + b)\ny_t = W_y*h_t',
    '参数共享使它能处理变长序列，但远距离信号被反复乘同一个矩阵，梯度消失或爆炸几乎不可避免。'],
  'lstm': [
    '把上一时刻隐藏状态与当前输入拼接|遗忘门决定保留多少旧细胞状态|输入门决定写入多少新候选|更新细胞状态，输出门决定暴露多少',
    'f = σ(W_f·[h_{t-1},x_t]+b_f)\ni = σ(W_i·[h_{t-1},x_t]+b_i); o = σ(W_o·[h_{t-1},x_t]+b_o)\nC̃ = tanh(W_C·[h_{t-1},x_t]+b_C)\nC_t = f*C_{t-1} + i*C̃\n h_t = o*tanh(C_t)',
    '细胞状态走加法通道，梯度能长距离流动；三个门各自可学习，参数量约为普通 RNN 的四倍。'],
  'gru': [
    '由当前输入与上一步隐藏状态算出更新门 z 与重置门 r|用 r 控制历史信息的参与程度生成候选状态|用 z 在旧状态与候选之间插值|得到新的隐藏状态',
    'z = σ(W_z·[h_{t-1},x_t]); r = σ(W_r·[h_{t-1},x_t])\nĥ = tanh(W·[r*h_{t-1}, x_t])\nh_t = (1-z)*h_{t-1} + z*ĥ',
    '参数比 LSTM 少约三分之一、训练更快；效果通常相当，但没有独立的细胞状态。'],
  'seq2seq': [
    '编码器逐个读入源序列并更新隐藏状态|用最后状态或注意力上下文作为解码起点|解码器每步自回归生成一个 token|把上一步输出作为下一步输入直到结束符',
    'h_1..h_T = Encoder(x_1..x_T)\ns_0 = h_T\nfor t = 1 .. T\':\n  c_t = Attention(s_{t-1}, h_1..h_T)\n  y_t = Decoder_step(s_{t-1}, c_t)',
    '瓶颈是单一上下文向量；注意力让解码器直接访问全部源位置，是 Transformer 的直接前身。'],
  'resnet': [
    '把卷积块的映射改成 F(x)+x|恒等跳连提供一条无损通路|反向传播时梯度可直接回到浅层|堆叠几十上百层仍可稳定训练',
    'y = F(x, W) + x        # 维度不符时用 1x1 卷积投影\nout = activation(y)',
    '解决的是深层网络退化问题，而不只是梯度消失；瓶颈结构（1x1-3x3-1x1）进一步压低计算量。'],
  'word2vec': [
    '选中心词并取出窗口内的上下文词|Skip-gram 用中心词预测每个上下文词|把未出现的词作为负样本推远|用 SGD 同时更新两组词向量',
    'for (center, context) in pairs:\n  for ctx in context ∪ negative_samples:\n    score = v_center · v_ctx\n    loss = -log σ(score) if positive else -log σ(-score)\n    update(v_center, v_ctx)',
    '共现词的向量被拉近，语义体现为向量空间的方向关系；负采样把全词表 softmax 降为几个样本，训练快得多。'],
  'crf': [
    '为每个位置计算标签的发射分数|用转移矩阵刻画标签之间的相邻约束|累加一条完整路径的发射分与转移分|维特比动态规划求全局得分最高的标签路径',
    'score(path) = Σ_t emit_t[path_t] + Σ_t trans[path_{t-1}, path_t]\nδ_t(j) = max_i δ_{t-1}(i) + trans[i,j] + emit_t[j]\nψ_t(j) = argmax_i ...\nbacktrack from best δ_T',
    '比逐位置独立分类更一致（如 BIO 标注里 I 不能跟在 O 后）；训练时用前向-后向算法计算配分函数。'],
  'contrastive-learning': [
    '对同一个样本做两次增强得到正样本对|把 batch 内其余样本当作负样本|用 InfoNCE 把正对相似度推高、负对推低|温度系数控制对困难负样本的关注程度',
    'z_i = f(aug_i); z_j = f(aug_j)\ns_ij = sim(z_i,z_j)/τ\nL_i = -log exp(s_ij) / Σ_{k!=i} exp(s_ik)',
    '无需标签即可学表示；温度越小越聚焦难负样本，但过小会训练不稳定。下游常需线性探针或少量标注微调。'],
  'knowledge-distillation': [
    '用教师模型对输入产生软标签（logits 除以温度 T 后 softmax）|学生同时拟合软标签与真实硬标签|用 T² 平衡软目标的梯度尺度|部署时用小模型替代大模型',
    'p_teacher = softmax(z_teacher / T)\np_student = softmax(z_student / T)\nL = T²*KL(p_teacher || p_student) + (1-α)*CE(z_student, y)',
    '软标签携带类别间相似度这种「暗知识」，信息量高于硬标签；T 太大分布过平，反而失去区分度。'],
  'quantization': [
    '统计权重或激活的取值范围|确定缩放比例 scale 与零点 zero_point|把浮点值映射到低比特整数并截断|推理时用整数乘加再反量化回浮点',
    'scale = (max-min)/(2^b-1); zp = round(-min/scale)\nq = clamp(round(x/scale) + zp, 0, 2^b-1)\nx_hat = (q - zp)*scale',
    'INT8 通常精度损失很小，INT4 需分组校准或量化感知训练；离群值会拉大 scale，降低有效精度。'],
  'mixed-precision': [
    '前向与反向用 FP16 或 BF16 计算|主权重副本保留 FP32|梯度先乘缩放因子 S 再转半精度以防下溢|更新主权重时除回 S',
    'with autocast: y = model_fp16(x)\nloss = loss_fn(y, target) * S\nscaler.scale(loss).backward()\noptimizer.step(); scaler.update()',
    'FP16 动态范围小容易下溢，BF16 指数范围与 FP32 相同通常无需缩放；显存约减半、吞吐明显提升。'],
  'rope': [
    '把 d 维向量按两维一组配对|每组视为复数，按位置 m 旋转角度 m·θ_i|对 Q、K 施加旋转而 V 不变|内积中只剩相对位置差，天然编码相对位置',
    'θ_i = 10000^(-2i/d)\nfor pair at position m:\n  x\'_{2i}   = x_{2i}*cos(mθ_i) - x_{2i+1}*sin(mθ_i)\n  x\'_{2i+1} = x_{2i}*sin(mθ_i) + x_{2i+1}*cos(mθ_i)\nQ\' = RoPE(Q,m); K\' = RoPE(K,n); O = softmax(Q\'K\'ᵀ/√d)V',
    '旋转不改变模长，内积只依赖相对位移；外推到更长上下文时可配合位置插值，已是主流大模型的位置编码方案。'],
  'greedy-decode': [
    '把模型输出的 logits 转成概率分布|每一步直接取概率最大的 token|把它拼到已生成序列末尾|重复直到结束符或长度上限',
    'seq = [bos]\nfor t = 1 .. T:\n  logits = model(seq)\n  next = argmax(logits)\n  if next == eos: break\n  seq.append(next)',
    '确定、最快，但缺乏多样性且容易陷入重复；温度、Top-k 等采样策略就是在贪心基础上引入可控随机性。'],
  'flash-attention': [
    '把 Q、K、V 分块载入 SRAM|对每块计算局部注意力并用在线 softmax 累积结果|只把最终输出写回显存|反向传播时重算中间量以省存储',
    'for block_Q in Q:\n  acc = 0; m = -inf; l = 0\n  for block_K, block_V in K,V:\n    S = block_Q @ block_Kᵀ / √d\n    m_new = max(m, rowmax(S)); P = exp(S-m_new)\n    l = exp(m-m_new)*l + rowsum(P)\n    acc = exp(m-m_new)*acc + P@block_V\n  O_block = acc/l',
    '计算量仍是 O(n²d)，但显存从 O(n²) 降到 O(n)；加速来自减少显存读写（IO 感知），不是少做乘法。'],
  'qlora': [
    '把基座权重离线量化到 4-bit 并冻结|在目标线性层旁路插入低秩 LoRA 矩阵|仅用 bf16 训练低秩参数|推理时可把适配器合并回反量化后的权重',
    'W4 = quantize_4bit(W_base); freeze(W4)\nA ~ N(0,σ²); B = 0\nh = dequant(W4)@x + (α/r)*B@A@x\ntrain only A,B with AdamW',
    '归一化量化、双重量化与分页优化器共同压显存；量化基座本身不更新，训练稳定性主要靠高精度适配器。'],
  'prompt-tuning': [
    '冻结整个预训练模型|在输入 token 前拼接一段可训练的连续向量|只把这段软提示纳入优化|每个下游任务各学一套提示向量',
    'P = trainable float[V_p, d]\ninput = concat(P, embed(task_tokens))\ny = frozen_LLM(input)\nloss = CE(y, target); update P only',
    '参数量常不到模型的千分之一，多任务切换只需换提示；随模型规模增大效果接近全量微调，小模型上不如 LoRA。'],
  'sft': [
    '收集高质量的指令-回答对|按模板拼成 prompt 与 response|只在回答部分计算下一步预测损失|训练后模型学会按指令格式输出',
    'for (instruction, response) in D:\n  x = template(instruction); y = tokenize(response)\n  for t = 1 .. len(y):\n    logits = model(x + y[:t-1])\n    loss += CE(logits, y[t])',
    '数据质量比数量更关键；掩码掉 prompt 部分的损失，避免模型学着复述问题。SFT 是 RLHF 的第一步。'],
  'ppo': [
    '让当前策略对 prompt 采样回答|用奖励模型打分并计算优势|用裁剪的重要性采样比限制更新幅度|加 KL 惩罚防止偏离参考策略，更新后重新采样',
    'for batch:\n  y ~ π_θ(·|x); r = reward(x,y)\n  A = r - β*KL(π_θ || π_ref)\n  ratio = π_θ(y|x)/π_old(y|x)\n  L = min(ratio*A, clip(ratio,1-ε,1+ε)*A)\n  θ += η∇L',
    '裁剪让策略不会一步走太远，是 RLHF 稳定的关键；需要奖励模型与在线采样，工程复杂度高于 DPO。'],
  'dpo': [
    '收集同一 prompt 下的 chosen / rejected 偏好对|用参考模型算两者的对数概率|构造隐含奖励差并送进 logistic 损失|直接更新策略，无需奖励模型与在线采样',
    'L = -log σ(β*[log π(y_w|x)/π_ref(y_w|x)\n           - log π(y_l|x)/π_ref(y_l|x)])\nθ += η∇L',
    '把 RLHF 化成分类式损失，训练便宜；但对偏好数据质量和 β 敏感，离线数据分布外行为难以保证。'],
  'hnsw': [
    '构建多层近邻图，上层作为下层的稀疏导航|插入节点时随机决定其层数|查询从最高层入口贪心游走到局部最近点|逐层下降，在底层做精细近邻搜索',
    'insert(q):\n  l = random_level(); ep = search_layer(top, q, ef)\n  for level from top down to l:\n    ep = search_layer(level, q, ef); connect(q, neighbors, M)\nsearch(q): ep = top_entry\n  for level top..0: ep = greedy(ep,q,level)\n  return search_layer(0,q,ef)',
    'M 控制每节点连接数、ef 控制搜索广度，越大召回越高也越慢；是主流向量数据库的高召回近似检索结构。'],
  'rag-rerank': [
    '先用向量或关键词快速召回 top-k 片段|用交叉编码器把 query 与每个片段拼接输入|得到更准的相关性分数并重新排序|只把最相关的少数片段放进有限上下文',
    'cands = retriever.search(q, k)        # 双塔，快\nscores = [cross_encoder(q, d) for d in cands]\ntop = sort(cands, by=scores, reverse=True)[:m]\nanswer = LLM(join(top) + q)',
    '交叉编码器让 query 与文档互相注意力，比双塔准但慢；通常 k 取 20~100、m 取 3~5，重排往往比单纯加大 k 更有效。'],
  'context-window': [
    '把输入按 token 上限切分|决定保留开头、结尾还是滑动窗口|超出部分截断或分块摘要后再汇总|拼上系统提示与历史对话送入模型',
    'tokens = tokenize(doc + history)\nif len(tokens) > max_ctx:\n  tokens = head(tokens,h) + tail(tokens,max_ctx-h)\n# 或 chunks = split(doc); summaries = [LLM(c) for c in chunks]\nanswer = LLM(system_prompt + tokens + query)',
    '超出窗口会报错或被静默截断；注意力成本随长度平方增长，长文档优先做检索或摘要，而不是硬塞进窗口。'],
  'long-context': [
    '用位置插值或 NTK 把位置编码扩展到更长范围|对注意力做稀疏化或分块以降低平方成本|配合长文本微调稳定外推效果|用大海捞针测试验证有效长度',
    '# 位置插值\npos\' = pos * (L_train / L_target)\nq = RoPE(q, pos\'); k = RoPE(k, pos\')\n# 稀疏注意力\nmask = local_window ∪ global_tokens ∪ strided_pattern\nO = softmax(QKᵀ/√d + mask)V',
    '标称上下文长度不等于有效长度，中段信息常被忽略；位置外推通常需要配套微调才能保持质量。'],
  'quantization-llm': [
    '用少量校准数据统计各层激活分布|按通道或分组确定缩放系数|把权重压到 4-bit 而激活保留 16-bit|推理时反量化后走普通算子',
    'for layer in model:\n  scales = calibrate(activation_stats, group_size)\n  W_int4 = quantize(W, scales)\ninference: y = (W_int4 * scales) @ x     # W4A16',
    'W4A16 在精度损失很小的前提下把显存降到约四分之一；异常激活通道是精度杀手，常用平滑迁移处理。'],
  'speculative-decoding': [
    '用小模型自回归写出 γ 个草稿 token|把草稿拼成一段让大模型一次并行验证|按概率接受前缀，遇到拒绝就从修正分布重新采样|已接受部分照常输出后进入下一轮',
    'draft = [small_model_step() for _ in range(γ)]\np = big_model_verify(prefix + draft); q = small_probs\np[i] = min(1, p[i]/q[i])\nfor i in 0..γ-1:\n  if rand() < p[i]: accept(draft[i])\n  else: emit(sample(normalize(p[i]-q[i]))); break',
    '草稿被接受时几乎无损加速；草稿过于激进会降低接受率，γ 需按两个模型的匹配程度调整。'],
  'agent-tool-use': [
    '把任务目标与工具 schema 一起放进上下文|模型先思考再决定是否调用工具|解析出结构化调用参数并执行|把观察结果写回上下文，循环直到给出答案',
    'ctx = system + task + tool_schemas\nwhile not done:\n  msg = LLM(ctx)\n  if msg.tool_call:\n    obs = execute(msg.tool_call); ctx += obs\n  else: done = true; answer = msg.text',
    '关键是工具描述清晰和错误正确回灌；每轮都要留意上下文膨胀与最大轮数限制，否则容易陷入无效循环。'],
  'function-calling': [
    '把工具定义以 JSON Schema 注入系统提示|让模型按约定格式输出调用名称与参数|解析 JSON 并做类型与取值校验|执行后把结果作为新消息继续对话',
    'tools = [{"name":"get_weather","parameters":{...}}]\nmsg = LLM(messages, tools=tools)\nif msg.tool_calls:\n  args = json.loads(msg.tool_calls[0].arguments)\n  result = dispatch(name, args); messages += tool_result(result)',
    '结构化输出靠训练与约束共同保证，仍可能生成非法参数，所以必须校验；工具描述不宜塞得过长。'],
  'chain-of-thought': [
    '在提示里加入少量带推理过程的示例|让模型先写出中间步骤再给答案|把思考显式展开为可读文本|从推理末尾抽取最终答案',
    'prompt = few_shot_examples_with_reasoning + question\nreasoning = LLM(prompt, max_tokens=...)\nanswer = extract_answer(reasoning)',
    '用更多生成 token 换多步推理准确率；简单任务上反而更慢更贵，且推理链看起来合理不代表结论一定正确。'],
  'rag-evaluation': [
    '为每条问题标注标准答案与相关文档|检索侧评估 recall@k 与 MRR|生成侧评估上下文相关性与答案忠实度|按环节定位是检索没召回还是生成没用好',
    'for q in eval_set:\n  docs = retriever(q)\n  recall_k = recall_at_k(docs, gold_docs)\n  answer = generator(q, docs)\n  faithful = entailment(answer, docs); correct = match(answer, gold)',
    '分开评检索与生成才能定位失效点；忠实度高但答案错误，通常说明检索根本没给到正确证据。'],
  'guardrail': [
    '在输入侧检测越界内容与提示注入|在模型输出后做规则与模型过滤|对工具调用做白名单与权限校验|拦截时返回安全回复或触发人工复核',
    'in = input_filter(user_message)\nif in.blocked: return safe_refusal\nout = output_filter(LLM(in))\nif out.tool_call: check_allowlist(out.tool_call)\nreturn out',
    '单一护栏不可靠，应多层叠加；规则过严会误伤正常请求，需要用真实流量持续校准。'],
  'boolean-retrieval': [
    '把每个词项映射到升序排列的文档列表|AND 对两条列表求交|OR 求并、NOT 求差|按布尔表达式组合出精确结果集',
    'postings = index[term]       # 升序 docid\nAND(a,b): merge_intersect(a,b)\nOR(a,b):  merge_union(a,b)\nNOT(a):   complement(a, universe)\nresult = evaluate(query_ast)',
    '精确匹配、结果可解释，但用户得自己写查询表达式；无法表达「大致相关」这类语义需求。'],
  'inverted-index': [
    '对每个文档分词并统计词项|为词项建立 postings 列表，记录 docid、词频与位置|查询时取出各词对应的列表|按 docid 升序归并得到候选文档集',
    'for doc in corpus:\n  for term, tf, pos in analyze(doc):\n    postings[term].append((docid, tf, pos))\nquery(t1,t2): lists=[postings[t] for t in ...]; merge_ascending(lists)',
    '搜索系统的核心数据结构；postings 按 docid 排序才能线性归并，工程上还会加跳表与压缩以省空间和加速。'],
  'tf-idf': [
    '统计词在文档中的出现次数 tf|统计包含该词的文档数 df 并计算 idf|把 tf 与 idf 相乘得到词权重|文档得分是查询中各词权重之和',
    'tf(t,d) = count(t in d)\nidf(t) = log(N / (1+df(t)))\nw(t,d) = tf(t,d) * idf(t)\nscore(q,d) = Σ_{t in q} w(t,d)',
    '抑制「的」「the」这类到处出现的词；词袋模型忽略词序与语义，是 BM25 和向量检索的重要基线。'],
  'pagerank-ir': [
    '把链接视为投票，每个网页把得分平均分给出链目标|加入阻尼因子以处理孤立节点|反复迭代直到各节点分数收敛|归一化后按权威度排序',
    'PR(i) = (1-d)/N + d*Σ_j PR(j)/outdeg(j)\nrepeat until convergence:\n  PR_new = compute(PR); PR = PR_new\nnormalize(PR)',
    '阻尼因子常取 0.85；收敛慢但稳定，是图排序与权威度传播的经典，也体现了马尔可夫链稳态思想。'],
  'vector-retrieval': [
    '用同一个编码器把查询与文档映射成向量|选择内积、余弦或 L2 作为相似度|暴力扫描或借助 ANN 索引找最近的 k 个|返回候选文档及其相似度分数',
    'q_vec = encoder(query)\nd_vecs = [encoder(doc) for doc in corpus]\nscores = [sim(q_vec, d) for d in d_vecs]\ntopk = argsort(scores)[-k:]',
    '小规模可暴力扫，大规模依赖 ANN 索引；向量质量取决于编码器，语义相似不等于精确匹配。'],
  'lsh': [
    '设计一族哈希，使相似对象碰撞概率更高|用多张哈希表把向量映射成签名|查询时只在同桶内寻找候选|对候选再做精确距离验证',
    'for table in tables:\n  sig = [dot(x,r_j) > 0 for r_j in table.planes]\n  bucket[table][sig].append(x)\nquery(q): cand = union(bucket[t][sig(q)]); return exact_topk(cand,q)',
    '用概率换速度，召回率由哈希族和表数决定；桶太大时会退化成近似暴力扫描。'],
  'hybrid-search': [
    '让关键词检索与向量检索并行执行|各自得到 top-k 候选列表|对两路分数归一化或按名次融合|截断得到最终候选集',
    'bm25_list = bm25.search(q,k)\nvec_list = vector.search(q,k)\nfused = α*normalize(bm25_list) + (1-α)*normalize(vec_list)\nreturn fused[:N]',
    '关键词擅长专有名词与精确短语，向量擅长同义与表述差异；α 需按查询类型调，RRF 可免去归一化。'],
  'reciprocal-rank-fusion': [
    '对每路召回结果按名次计算倒数排名分|同一文档出现在多路就累加分数|按总分重新排序|取前 N 条作为融合结果',
    'score[d] = 0\nfor result_list in result_lists:\n  for rank, d in enumerate(result_list, start=1):\n    score[d] += 1/(k + rank)\nreturn sort(score, reverse=True)[:N]',
    '只依赖名次、不管各路分数量纲，因此融合很稳健；k 常取 60，用来抑制第一名过度主导。'],
  'semantic-search': [
    '用双塔编码器把查询与文档映射到同一向量空间|近似召回一批候选片段|用交叉编码器对候选逐对精排|返回语义最相关的结果',
    'cands = ann_search(encoder_q(q), doc_vectors, k)\nfor d in cands: s = cross_encoder(q,d)\nreturn sort(cands, by=s, reverse=True)[:m]',
    '解决同义、改写与跨语言匹配；两阶段兼顾速度与精度，精排开销随召回数量 k 线性增长。'],
  'query-expansion': [
    '从同义词词典或词向量找查询词的近义词|把这些词加入原查询重新检索|也可用首轮结果做伪相关反馈|合并两轮结果后重排',
    'terms = tokenize(q)\nexpanded = terms ∪ synonyms(terms) ∪ pseudo_relevance(top_docs)\nresult = search(join(expanded))',
    '提升召回但容易引入噪声；领域词典通常比通用同义词表更有效，扩展词太多会稀释原查询意图。'],
  'bpr': [
    '为每个用户采样一个正样本物品和一个未观测物品|计算用户对两者的预测偏好差|用成对排序损失最大化这个差值|SGD 更新用户与物品隐向量',
    'for (u,i,j) in samples:\n  x_uij = score(u,i) - score(u,j)\n  loss = -log σ(x_uij) + λ||θ||²\n  θ -= η∇loss',
    '直接优化排序而非评分误差，更适合隐式反馈；未观测不等于不喜欢，负采样策略会显著影响效果。'],
  'content-based': [
    '把物品属性与用户画像表示成同维向量|对每个候选物品计算与用户向量的相似度|按相似度排序得到 Top-N|新物品只要有属性就能被推荐',
    'profile_u = weighted_average(items_user_liked)\nfor item in catalog:\n  score = cosine(profile_u, features_item)\nreturn top_k(score)',
    '无需他人行为，天然缓解物品冷启动且可解释；但难以发现用户尚未表达过的新兴趣，效果依赖属性质量。'],
  'svd-als': [
    '把评分矩阵近似为用户隐因子 P 与物品隐因子 Q 的乘积|固定 Q 时对每个用户求闭式最小二乘解|再固定 P 更新 Q|交替迭代直到 RMSE 收敛',
    'init(P,Q)\nrepeat:\n  for u: P[u] = solve(Q_IᵀQ_I + λI, Q_Iᵀ r_u)\n  for i: Q[i] = solve(P_UᵀP_U + λI, P_Uᵀ r_i)\nuntil RMSE converges',
    '每一步都有闭式解、易并行，适合隐式反馈（按置信度加权）；目标非凸，但交替最小二乘通常稳定收敛。'],
  'fm': [
    '把每个特征映射成 k 维隐向量|线性部分建模一阶贡献|两两特征用隐向量内积建模二阶交叉|相加得到预测点击率',
    'y = w0 + Σ_i w_i*x_i + Σ_{i<j} <v_i,v_j>*x_i*x_j\n# 二阶项可用恒等式在 O(nk) 内计算:\n# Σ_i (v_i·x_i)² - Σ_i (v_i²*x_i²)',
    '隐向量让未见过的特征组合也能泛化；二次项可在线性时间内算出，是 CTR 预估的经典基线。'],
  'ffm': [
    '按特征所属的域为每个特征学多套隐向量|两个特征交叉时用各自针对对方域的那套向量|所有域对交叉求和再加线性项|输出点击率预测',
    'y = w0 + Σ_i w_i*x_i + Σ_{i<j} <v_{i,f_j}, v_{j,f_i}>*x_i*x_j',
    '比 FM 表达更细，但参数量从 nk 涨到 nfk，需要更多数据与正则；域划分（用户域/物品域/上下文域）由业务定义。'],
  'wide-deep': [
    '宽部是线性模型，输入原始特征与人工叉乘特征|深部用 embedding 加 MLP 学习高阶组合|两部分输出相加后过 sigmoid|端到端联合训练',
    'y_wide = w·x + b\ny_deep = MLP(concat(embed(x_cat), x_num))\ny = sigmoid(y_wide + y_deep)',
    '宽部负责记忆高频共现组合，深部负责泛化未见组合；人工叉乘特征仍是宽部效果的关键。'],
  'deepfm': [
    '用 FM 层替换 Wide & Deep 的宽部|FM 与 Deep 共享同一套 embedding|FM 学二阶交叉、Deep 学高阶交叉|两部分相加后输出',
    'emb = lookup(E, x_cat)\ny_fm = linear(x) + fm_second_order(emb)\ny_deep = MLP(concat(emb, x_num))\ny = sigmoid(y_fm + y_deep)',
    '共享 embedding 让低阶与高阶交叉端到端联合学习，省去大量人工特征工程；是 CTR 任务的强基线。'],
  'din': [
    '取用户历史行为序列与目标物品|用目标物品作为 query 对历史做注意力|得到随目标变化的兴趣表示|拼接其他特征送入 DNN 预测点击率',
    'h = attention(query=target_item, keys=history, values=history)\nfeature = concat(h, user_feats, target_feats, context)\ny = DNN(feature)',
    '同一用户在看手机和看电脑时兴趣向量不同，这是 DIN 的核心；历史序列越长计算越贵，工程上会截断。'],
  'dssm': [
    '把查询和文档分别送入各自的塔网络|映射到同维语义向量|用余弦相似度打分|对比损失拉近正样本、推远负样本',
    'q_vec = f(query); d_vec = g(doc)\ns = cos(q_vec, d_vec)\nL = -log exp(s+/τ) / Σ exp(s_i/τ)',
    '是双塔召回的早期形态；两塔解耦让文档向量可离线预计算，代价是交互只发生在最后一层、表达受限。'],
  'gbdt-lr': [
    '用 GBDT 做特征组合与分桶|每个样本落到各树的叶子编号|把叶子编号拼成 one-hot 稀疏向量|交给 LR 做线性加权预测',
    'trees = train_gbdt(D)\nfor x in D:\n  leaves = [leaf_index(t,x) for t in trees]\n  x\' = one_hot(leaves) + original_features\nmodel_lr = train_lr(x\', y)',
    '树自动完成非线性组合，LR 负责线性加权与概率校准；两阶段训练，并非端到端。'],
  'sasrec': [
    '把用户历史物品按时间排成序列|加入位置编码并用因果掩码做自注意力|取最后一个位置的表示|与候选物品匹配预测下一次交互',
    'X = embed(items) + pos_encoding\nfor block in blocks:\n  X = LN(X + MHA(X, causal_mask))\n  X = LN(X + FFN(X))\nscore_i = <X[-1], item_emb_i>',
    '因果掩码保证第 t 位只看前 t 个行为；没有长期画像也能建模序列兴趣，长序列受平方复杂度限制。'],
  'dpp-rerank': [
    '把候选物品构造成核矩阵，元素同时体现质量与相似度|用行列式衡量整个集合的相关性与多样性|贪心每步选边际增益最大的物品|直到达到目标列表长度',
    'L = diag(rel) + rel*sim*rel\nselected = []\nwhile len(selected) < M:\n  gain = det(L[S∪{i}]) - det(L[S])\n  pick argmax_i gain; selected.append(i)',
    '行列式同时惩罚相似物品、奖励高相关物品，是集合层面的优化；精确计算 O(n³)，因此需要贪心近似。'],
  'learning-to-rank': [
    '按打分对象分为点级、对级、列表级三类损失|点级预测相关度，对级优化偏好对，列表级直接优化排序指标|训练后用 NDCG 与 MAP 评估效果',
    '# pointwise: L = CE(score_i, rel_i)\n# pairwise:  L = -log σ(score_i - score_j), rel_i > rel_j\n# listwise:  L = -Σ_i rel_i*log softmax(score_i)',
    '排序指标不可导，列表级用可导代理损失近似；对级最常用，效果与实现成本比较平衡。'],
  'lambdamart': [
    '根据标签与所在位置算出每对文档的 NDCG 变化量|把变化量乘 pairwise 梯度得到 lambda|用 GBDT 拟合这些 lambda|更新分数后重算 lambda，多轮提升 NDCG',
    'for pair (i,j):\n  ΔNDCG = |rel_i-rel_j| * discount(position)\n  λ_ij = ΔNDCG * σ(-0.5*(s_i-s_j))\ntrain GBDT on λ gradients; update scores; repeat',
    '把排序指标直接嵌进梯度，是搜索排序的经典方案；λ 依赖当前排序，所以每轮都要重算。'],
  'cold-start': [
    '先判断是新用户还是新物品|新用户用热门、上下文或人口属性推荐|新物品靠内容属性与人工标注入池|积累少量行为后切到个性化模型',
    'if user is new: rec = popular + context_based\nelif item is new: score = content_similarity(profile, item_features)\nelse: score = personalized_model(u,i)\n# 用试探流量给新物品曝光以积累行为',
    '没有行为时只能靠内容、上下文或试探流量；冷启动阶段应偏向探索而非精准，并单独评估。'],
  'graph-rec': [
    '把用户与物品建成二部图|从目标用户出发做多跳随机游走或图卷积|聚合邻居得到用户与物品的高阶表示|按表示相似度召回候选物品',
    'G = bipartite_graph(users, items)\nh_u = aggregate(neighbors of u, multi_hops)\nh_i = aggregate(neighbors of i, multi_hops)\nscore(u,i) = <h_u,h_i>',
    '能捕捉协同过滤取不到的高阶连接；图越大邻居采样越关键，全图训练不可扩展。'],
  'session-rec': [
    '只取当前匿名会话的点击序列|用 GRU 或自注意力编码成会话表示|与候选物品向量做匹配|预测下一步最可能点击的物品',
    'h = GRU(embed(session_items))\nfor item in candidates: score = <h, embed(item)>\nreturn top_k(score)',
    '不依赖长期画像，适合匿名流量与短时兴趣；会话很短时效果有限，常与热门兜底结合。'],
  'federated-rec': [
    '服务端下发当前全局推荐模型|被选中的客户端在本地行为数据上训练若干步|只上传模型更新或梯度|服务端按数据量加权平均后进入下一轮',
    'for round in 1..T:\n  broadcast(global_model)\n  updates = [local_train(client) for client in sampled]\n  global_model = Σ (n_k/N)*update_k',
    '原始数据不出端，降低隐私风险；但客户端数据分布异构、通信开销大，聚合容易被异常更新拖偏。'],
  'euclidean-gcd': [
    '用带余除法写成 a = b·q + r|把数对 (a,b) 更新为 (b,r)|重复直到余数为 0|最后的非零余数就是最大公约数',
    'gcd(a,b):\n  while b != 0:\n    a, b = b, a % b\n  return a\n# 扩展版记录系数使 a*x + b*y = gcd(a,b)',
    '复杂度 O(log n)。扩展欧几里得能求模逆元，是 RSA 等公钥算法的基础。'],
  'sieve-eratosthenes': [
    '建布尔数组并初始化为全真|从 p=2 起，若 p 未被标记就从 p² 开始划掉它的倍数|继续到 √n|剩下未标记的下标即所有素数',
    'is_prime = [true]*(n+1); is_prime[0]=is_prime[1]=false\nfor p = 2 .. sqrt(n):\n  if is_prime[p]:\n    for m = p*p; m <= n; m += p: is_prime[m] = false',
    '从 p² 开始避免重复划掉更小的倍数；复杂度 O(n log log n)，区间很大时改用分段筛。'],
  'modular-exponentiation': [
    '把指数写成二进制|维护结果 res=1 与底数 base|底数每轮平方，指数该位为 1 时把 base 乘进结果|每步取模避免中间值爆炸',
    'pow_mod(a,e,m):\n  res = 1; a %= m\n  while e > 0:\n    if e & 1: res = res*a % m\n    a = a*a % m; e >>= 1\n  return res',
    '把 O(e) 次乘法降到 O(log e)；密码学中的指数极大，快速幂是运算可行的前提。'],
  'primality-miller-rabin': [
    '把 n−1 写成 d·2^s 的形式|随机选一个底数 a 并计算 a^d mod n|若结果为 1 或 n−1 则本轮通过|否则连续平方 s−1 次，出现 n−1 则通过，否则 a 是合数见证',
    'n-1 = d*2^s\nfor a in bases:\n  x = pow_mod(a,d,n)\n  if x in {1,n-1}: continue\n  for r = 1 .. s-1:\n    x = x*x % n\n    if x == n-1: break\n  else: return composite\nreturn probably_prime',
    '单轮误判概率不超过 1/4，多轮底数后概率极低；这是概率算法，不是确定性证明。'],
  'diffie-hellman': [
    '双方公开约定大素数 p 与生成元 g|各自选秘密指数 a、b|只交换公开值 A=g^a mod p 与 B=g^b mod p|各自算出同一个共享密钥',
    'public: p, g\nAlice: a secret; A = g^a mod p; send A\nBob:   b secret; B = g^b mod p; send B\nAlice: s = B^a mod p; Bob: s = A^b mod p',
    '安全性依赖离散对数难解；协议本身不认证身份，中间人攻击需要额外签名或证书来防御。'],
  'crc-checksum': [
    '选定生成多项式|在信息位后补上 r 个 0|逐位做模 2 除法|把得到的余数作为校验码附加到数据后',
    'reg = init\nfor bit in message:\n  top = MSB(reg)\n  reg = (reg << 1) & mask\n  if top: reg ^= poly\nreturn reg',
    '检测突发错误的能力强，但不是密码学哈希，不能防蓄意篡改；工程实现常用查表法提速。'],
  'fast-fourier-transform': [
    '把输入按位反转重新排列|自底向上按长度逐层合并|每对蝶形运算用旋转因子结合|全部层结束后得到频域表示',
    'a = bit_reverse(a)\nfor len = 2; len <= n; len *= 2:\n  W = exp(-2πi/len)\n  for i step len:\n    for j = 0 .. len/2-1:\n      u = a[i+j]; v = a[i+j+len/2]*W^j\n      a[i+j] = u+v; a[i+j+len/2] = u-v',
    '分治把 DFT 从 O(n²) 降到 O(n log n)；旋转因子可预计算，逆变换只需取共轭或调整符号。'],
  'binary-answer': [
    '确定一个关于答案的单调判定函数 f(x)|找出可行区间 [lo,hi]|取中点 mid 做判定|可行则收缩左边界，否则收缩右边界',
    'lo, hi = min, max\nwhile lo < hi:\n  mid = (lo+hi)//2\n  if feasible(mid): lo = mid+1\n  else: hi = mid\nreturn lo',
    '关键是判定函数必须单调；整数二分的边界写法要格外小心，否则会死循环或漏掉答案。'],
  'ternary-search': [
    '确认函数在区间上是单峰的|取两个三分点 m1 < m2|比较 f(m1) 与 f(m2)|丢掉较劣一侧后缩小一个三分之一的区间',
    'while hi-lo > eps:\n  m1 = lo+(hi-lo)/3; m2 = hi-(hi-lo)/3\n  if f(m1) < f(m2): lo = m1   # 求最大值时方向相反\n  else: hi = m2\nreturn (lo+hi)/2',
    '每轮只缩小约三分之一，收敛慢于二分；只适用于严格单峰函数。'],
  'newton-method': [
    '在当前近似点求函数值与导数|用切线与 x 轴的交点作为下一个近似|重复直到相邻两次变化足够小|在根附近呈平方收敛',
    'x = x0\nfor t = 1 .. T:\n  x_new = x - f(x)/f\'(x)\n  if abs(x_new-x) < eps: break\n  x = x_new',
    '收敛快但依赖初值，导数接近 0 时会发散；多元情形需解线性方程组或用拟牛顿近似。'],
  'convex-optimization': [
    '确认目标函数与约束集合都是凸的|沿负梯度方向迭代|把迭代点投影回可行域|满足 KKT 条件时即为全局最优',
    'x = x0\nwhile not converged:\n  x = project(x - η∇f(x), C)\n# KKT: ∇f + Σλ_i∇g_i = 0, λ_i*g_i = 0, λ_i >= 0',
    '凸性保证局部最优就是全局最优，这是问题能被可靠求解的根本原因；非凸问题套用只能得到局部解。'],
  'lagrange-multiplier': [
    '把等式约束乘上 λ 并入目标函数|对原变量和 λ 分别求偏导并令其为零|联立解出候选极值点|检查是否满足约束与二阶条件',
    'L(x,λ) = f(x) + λ*g(x)\n∇_x L = ∇f + λ∇g = 0\n∂L/∂λ = g(x) = 0\nsolve joint equations',
    '等值线与约束曲线相切处就是带约束最优点；λ 是影子价格，表示放宽约束带来的边际收益。'],
  'mcmc': [
    '从当前状态随机提议一个新状态|按目标分布密度比计算接受概率|掷随机数决定是否移动|运行足够长后样本近似目标分布',
    'x = x0\nfor t = 1 .. T:\n  x\' = propose(x)\n  α = min(1, π(x\')/π(x))\n  if rand() < α: x = x\'\n  samples.append(x)',
    '步长太大接受率低、太小混合慢；需要丢弃前期 burn-in，且样本之间存在自相关。'],
  'genetic-algorithm': [
    '初始化一组候选解|按适应度选择父代|交叉重组并随机变异产生子代|保留精英后替换种群，重复多代',
    'pop = random_population()\nfor gen = 1 .. G:\n  fitness = evaluate(pop)\n  parents = select(pop, fitness)\n  children = mutate(crossover(parents))\n  pop = elitism(pop) + children\nreturn best(pop)',
    '适合离散组合与无梯度问题；对种群规模、变异率等参数敏感，不保证找到全局最优。'],
  'particle-swarm': [
    '初始化每个粒子的位置与速度|每个粒子记住自身历史最优 pBest|群体共享全局最优 gBest|用惯性、个体与群体三项合成速度并更新位置',
    'v = w*v + c1*r1*(pBest-x) + c2*r2*(gBest-x)\nx = x + v\nupdate pBest and gBest by fitness',
    '无需梯度、参数少；惯性权重从大到小衰减有助于先探索后收敛，容易早熟收敛到局部最优。'],
  'em-algorithm': [
    '初始化模型参数|E 步用当前参数计算隐变量的后验责任|M 步用责任作权重重新估计参数|重复直到对数似然变化很小',
    'init(θ)\nrepeat:\n  γ_ik = P(z_i=k | x_i, θ)\n  θ = argmax_θ Σ_i Σ_k γ_ik*log P(x_i,z_i=k|θ)\nuntil L(θ) converges',
    '对数似然单调不减，但只保证局部最优；GMM 是它最直观的例子。'],
  'bayes-inference': [
    '为参数选择一个先验分布|根据观测数据写出似然函数|用贝叶斯公式把先验更新成后验|报告后验均值与可信区间',
    'prior: θ ~ Beta(α,β)\nlikelihood: k successes in n trials\nposterior: θ|data ~ Beta(α+k, β+n-k)',
    '共轭先验让更新简化为计数加减；数据越多后验越尖，不确定性自然下降。'],
  'markov-chain': [
    '定义状态空间与转移矩阵|用初始分布乘转移矩阵得到下一时刻的分布|反复迭代观察分布如何演化|检查是否收敛到稳态分布',
    'π_0 = initial_distribution\nfor t = 1 .. T:\n  π_t = π_{t-1} @ P\nsteady if ||π_t - π_{t-1}|| < eps',
    '下一状态只依赖当前状态；只有不可约且非周期的链才有唯一稳态，PageRank 与 MCMC 都建立在它之上。'],
  'hmm': [
    '定义隐藏状态的转移矩阵 A、发射矩阵 B 与初始分布 π|每个时刻隐藏状态生成一个观测|用前向递推计算观测序列的概率|用后向概率推断各时刻的隐藏状态',
    'α_1(j) = π_j*b_j(O_1)\nα_t(j) = (Σ_i α_{t-1}(i)*a_ij) * b_j(O_t)\nP(O) = Σ_j α_T(j)\nβ_t(i) = Σ_j a_ij*b_j(O_{t+1})*β_{t+1}(j)',
    '三个基本问题：评估用前向后向、解码用维特比、学习用 Baum-Welch；状态数平方决定计算成本。'],
  'viterbi': [
    '定义 δ_t(j) 为时刻 t 以状态 j 结尾的最优路径概率|递推时取上一时刻各状态转移再乘发射分的最大值|同时记录每一步的最佳前驱|从末列回溯得到完整隐状态序列',
    'δ_1(j) = π_j*b_j(O_1)\nfor t = 2 .. T:\n  δ_t(j) = max_i δ_{t-1}(i)*a_ij * b_j(O_t)\n  ψ_t(j) = argmax_i δ_{t-1}(i)*a_ij\npath_T = argmax_j δ_T(j); backtrack via ψ',
    '动态规划把指数级路径搜索降到 O(T·S²)；改用对数概率可避免连乘下溢。'],
  'differential-privacy': [
    '计算查询函数对相邻数据集的敏感度 Δ|选定隐私预算 ε|向查询结果加 Laplace(Δ/ε) 噪声|多次查询时累加预算并留有余量',
    'Δ = max over adjacent D,D\' of |f(D)-f(D\')|\nanswer = f(D) + Laplace(scale=Δ/ε)\n# 基本组合定理：多次查询 ε 累加',
    'ε 越小隐私保护越强、数据可用性越差；敏感度必须对相邻数据集严格成立，否则名义预算无效。'],
  'federated-learning': [
    '服务端下发当前全局模型|被选中的客户端在本地数据上训练若干步|只上传模型更新或梯度|服务端按数据量加权平均后进入下一轮',
    'for round in 1..T:\n  broadcast(global_model)\n  updates = [local_train(client) for client in sampled]\n  global_model = Σ (n_k/N)*update_k',
    '原始数据不出端，但上传梯度仍可能泄露信息，常需安全聚合或差分隐私；客户端异构会让收敛变慢。'],
};

export const getDetail = (id) => {
  const d = DETAILS[id];
  if (!d) return null;
  return { steps: d[0].split('|'), pseudo: d[1], insight: d[2] };
};
