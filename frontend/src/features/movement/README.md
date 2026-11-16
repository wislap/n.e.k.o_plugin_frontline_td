# movement

## 职责
单位移动结算（ADR 0010）：沿寻路流场转向、均匀网格分离推挤、
可通行性积分。移动命令 `frontline_td:movement.move` 在此登记。

## 公开接口
- `sim/index.ts`: `createMovementModule(terrain, pathing) → SimModule`；
  `MoveCommand`（payload `{ units: handle[], x, y }`）；
  组件 `Position` / `Velocity` / `Mover` / `MoveTarget`。

## 拥有的组件
- `Position {x,y:f64}`、`Velocity {x,y:f64}`、`Mover {speed,radius,cls}`、
  `MoveTarget {goal:u32,x,y,active:u8}` —— 只有本模块可写。

## 不变量
- 三个系统固定顺序：steer → separate → integrate（movement 相位）。
- 移动命令先校验再改状态：按移动类别收集目标周围可通行且与目标
  连通的槽位（方环螺旋、半径 ≤ ⌈√n⌉+8，不足则循环复用），再按
  保形贪心分配（按距编队质心距离降序取最近未占槽位）。
- 槽位 8 格内且格子直线可走（DDA，逐步 stepCost ≥ 0）就直线驶向
  槽位，否则跟流场；到达判定 = 距槽位 ≤ 0.3，到达后 active=2 驻留
  （被分离推开时直线驶回槽位）；流场不可达则 active=0 停止。
- 分离推挤阈值 = rA + rB + 0.2（SEPARATION_GAP），用 2 格均匀桶、
  升序 id、固定邻桶序；重合时按 id 奇偶选轴。
- 积分只允许可通行步，整步失败时先尝试仅 x、再仅 y；位置夹在地图内。
- 目标不可达（流场返回 null）按到达处理并释放目标。

## 对应设计章节
architecture.md §6/§7.3、ADR 0010、ADR 0020。
