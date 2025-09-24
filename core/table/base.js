import {Cell} from "./cell.js";
import {filterSavingData} from "./utils.js";

const SheetDomain = {
    global: 'global',
    role: 'role',
    chat: 'chat',
}
const SheetType = {
    free: 'free',
    dynamic: 'dynamic',
    fixed: 'fixed',
    static: 'static',
}
const customStyleConfig = {
    mode: 'regex',
    basedOn: 'html',
    regex: '/(^[\\s\\S]*$)/g',
    replace: `$1`,
    replaceDivide: '',  //用于临时保存分离后的css代码
}

export class SheetBase {
    static SheetDomain = SheetDomain;
    static SheetType = SheetType;

    constructor() {
        // 以下为基本属性
        this.uid = '';
        this.name = '';
        this.domain = '';
        this.type = SheetType.dynamic;
        this.enable = true;                     // 用于标记是否启用
        this.required = false;                  // 用于标记是否必填
        this.tochat = true;                     // 用于标记是否发送到聊天
        this.triggerSend = false;               // 用于标记是否触发发送给AI
        this.triggerSendDeep = 1;               // 用于记录触发发送的深度

        // 以下为持久化数据
        this.cellHistory = [];                  // cellHistory 持久保持，只增不减
        this.hashSheet = [];                    // 每回合的 hashSheet 结构，用于渲染出表格

        this.config = {
            // 以下为其他的属性
            toChat: true,                     // 用于标记是否发送到聊天
            useCustomStyle: false,            // 用于标记是否使用自定义样式
            triggerSendToChat: false,            // 用于标记是否触发发送到聊天
            alternateTable: false,            // 用于标记是否该表格是否参与穿插模式，同时可暴露原设定层级
            insertTable: false,                  // 用于标记是否需要插入表格，默认为false，不插入表格
            alternateLevel: 0,                     // 用于标记是穿插并到一起,为0表示不穿插，大于0按同层级穿插
            skipTop: false,                     // 用于标记是否跳过表头
            selectedCustomStyleKey: '',       // 用于存储选中的自定义样式，当selectedCustomStyleUid没有值时，使用默认样式
            customStyles: {'自定义样式': {...customStyleConfig}},                 // 用于存储自定义样式
            // 过滤键配置
            filterEnabled: false,              // 是否启用过滤
            filterKeys: []                     // 过滤键配置数组 [{sourceColumn: 1, refTableName: 'some_table_name', refColumn: 1}]
        }

        // 临时属性
        this.tableSheet = [];                        // 用于存储表格数据，以便进行合并和穿插

        // 以下为派生数据
        this.cells = new Map();                 // cells 在每次 Sheet 初始化时从 cellHistory 加载
        this.data = new Proxy({}, {     // 用于存储用户自定义的表格数据
            get: (target, prop) => {
                return this.source.data[prop];
            },
            set: (target, prop, value) => {
                this.source.data[prop] = value;
                return true;
            },
        });
        this._cellPositionCacheDirty = true;    // 用于标记是否需要重新计算 sheetCellPosition
        this.positionCache = new Proxy(new Map(), {
            get: (map, uid) => {
                if (this._cellPositionCacheDirty || !map.has(uid)) {
                    map.clear();
                    this.hashSheet.forEach((row, rowIndex) => {
                        row.forEach((cellUid, colIndex) => {
                            map.set(cellUid, [rowIndex, colIndex]);
                        });
                    });
                    this._cellPositionCacheDirty = false;   // 更新完成，标记为干净
                    console.log('重新计算 positionCache: ', map);
                }
                return map.get(uid);
            },
        });
    }
    get source() {
        return this.cells.get(this.hashSheet[0][0]);
    }

    markPositionCacheDirty() {
        this._cellPositionCacheDirty = true;
        // console.log(`标记 Sheet: ${this.name} (${this.uid}) 的 positionCache 为脏`);
    }

    init(column = 2, row = 2) {
        this.cells = new Map();
        this.cellHistory = [];
        this.hashSheet = [];

        // 初始化 hashSheet 结构
        const r = Array.from({ length: row }, (_, i) => Array.from({ length: column }, (_, j) => {
            let cell = new Cell(this);
            this.cells.set(cell.uid, cell);
            this.cellHistory.push(cell);
            if (i === 0 && j === 0) {
                cell.type = Cell.CellType.sheet_origin;
            } else if (i === 0) {
                cell.type = Cell.CellType.column_header;
            } else if (j === 0) {
                cell.type = Cell.CellType.row_header;
            }
            return cell.uid;
        }));
        this.hashSheet = r;

        return this;
    };

    rebuildHashSheetByValueSheet(valueSheet) {
        const cols = valueSheet[0].length
        const rows = valueSheet.length
        const usedCellUids = []; // 跟踪已使用的单元格uid
        const newHashSheet = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => {
            const value = valueSheet[i][j] || '';
            const cellType = this.getCellTypeByPosition(i, j);
            // 如果存在相同值的单元格，则复用该单元格，但排除已使用的单元格
            const oldCell = this.findCellByValue(valueSheet[i][j] || '', cellType, usedCellUids)
            if (oldCell) {
                usedCellUids.push(oldCell.uid); // 标记为已使用
                return oldCell.uid; // 复用已有单元格
            }
            const cell = new Cell(this);
            this.cells.set(cell.uid, cell);
            this.cellHistory.push(cell);
            cell.data.value = valueSheet[i][j] || ''; // 设置单元格的值
            if (i === 0 && j === 0) {
                cell.type = Cell.CellType.sheet_origin;
            } else if (i === 0) {
                cell.type = Cell.CellType.column_header;
            } else if (j === 0) {
                cell.type = Cell.CellType.row_header;
            }
            usedCellUids.push(cell.uid); // 标记新创建的单元格为已使用
            return cell.uid;
        }));
        this.hashSheet = newHashSheet
        return this
    }

    loadJson(json) {
        Object.assign(this, JSON.parse(JSON.stringify(json)));
        if(this.cellHistory.length > 0) this.loadCells()
        if(this.content) this.rebuildHashSheetByValueSheet(this.content)
        if(this.sourceData) this.source.data = this.sourceData

        this.markPositionCacheDirty();
    }

    getCellTypeByPosition(rowIndex, colIndex) {
        if (rowIndex === 0 && colIndex === 0) {
            return Cell.CellType.sheet_origin;
        }
        if (rowIndex === 0) {
            return Cell.CellType.column_header;
        }
        if (colIndex === 0) {
            return Cell.CellType.row_header;
        }
        return Cell.CellType.cell;
    }

    loadCells() {
        // 从 cellHistory 遍历加载 Cell 对象
        try {
            this.cells = new Map(); // 初始化 cells Map
            this.cellHistory?.forEach(c => { // 从 cellHistory 加载 Cell 对象
                const cell = new Cell(this);
                Object.assign(cell, c);
                this.cells.set(cell.uid, cell);
            });
        } catch (e) {
            console.error(`加载失败：${e}`);
            return false;
        }

        // 重新标记cell类型
        try {
            if (this.hashSheet && this.hashSheet.length > 0) {
                this.hashSheet.forEach((rowUids, rowIndex) => {
                    rowUids.forEach((cellUid, colIndex) => {
                        let cell = this.cells.get(cellUid);
                        if (!cell) {
                            cell = new Cell(this);
                            cell.uid = cellUid;
                            cell.data.value = '空数据'
                            this.cells.set(cell.uid, cell);
                        }
                        if (rowIndex === 0 && colIndex === 0) {
                            cell.type = Cell.CellType.sheet_origin;
                        } else if (rowIndex === 0) {
                            cell.type = Cell.CellType.column_header;
                        } else if (colIndex === 0) {
                            cell.type = Cell.CellType.row_header;
                        } else {
                            cell.type = Cell.CellType.cell;
                        }
                    });
                });
            }
        } catch (e) {
            console.error(`加载失败：${e}`);
            return false;
        }
    }

    findCellByValue(value, cellType = null, excludeUids = []) {
        const cell = this.cellHistory.find(cell => 
            cell.data.value === value && 
            (cellType === null || cell.type === cellType) &&
            !excludeUids.includes(cell.uid)
        );
        if (!cell) {
            return null;
        }
        return cell;
    }

    findCellByPosition(rowIndex, colIndex) {
        if (rowIndex < 0 || colIndex < 0 || rowIndex >= this.hashSheet.length || colIndex >= this.hashSheet[0].length) {
            console.warn('无效的行列索引');
            return null;
        }
        const hash = this.hashSheet[rowIndex][colIndex]
        const target = this.cells.get(hash) || null;
        if (!target) {
            const cell = new Cell(this);
            cell.data.value = '空数据';
            cell.type = colIndex === 0 ? Cell.CellType.row_header : rowIndex === 0 ? Cell.CellType.column_header : Cell.CellType.cell;
            cell.uid = hash;
            this.cells.set(cell.uid, cell);
            return cell;
        }
        console.log('找到单元格',target);
        return target;
    }
    /**
     * 通过行号获取行的所有单元格
     * @param {number} rowIndex
     * @returns cell[]
     */
    getCellsByRowIndex(rowIndex) {
        if (rowIndex < 0 || rowIndex >= this.hashSheet.length) {
            console.warn('无效的行索引');
            return null;
        }
        return this.hashSheet[rowIndex].map(uid => this.cells.get(uid));
    }
    /**
     * 获取表格csv格式的内容
     * @returns
     */
    getSheetCSV( removeHeader = true,key = 'value') {
        if (this.isEmpty()) return '（此表格当前为空）\n'
        console.log("测试获取map", this.cells)
        const content = this.hashSheet.slice(removeHeader?1:0).map((row, index) => row.map(cellUid => {
            const cell = this.cells.get(cellUid)
            if (!cell) return ""
            return cell.type === Cell.CellType.row_header ? index : cell.data[key]
        }).join(',')).join('\n');
        return content + "\n";
    }
    /**
     * 表格是否为空
     * @returns 是否为空
     */
    isEmpty() {
        return this.hashSheet.length <= 1;
    }

    filterSavingData(key, withHead = false) {
        return filterSavingData(this, key, withHead)
    }

    getRowCount() {
        return this.hashSheet.length;
    }

    /**
     * 获取表头数组（兼容旧数据）
     * @returns {string[]} 表头数组
     */
    getHeader() {
        const header = this.hashSheet[0].slice(1).map(cellUid => {
            const cell = this.cells.get(cellUid);
            return cell ? cell.data.value : '';
        });
        return header;
    }

    /**
     * 获取过滤后的 hashSheet - 无缓存优化版本
     * @param {Set} visitedTables - 已访问的表格集合，用于检测循环依赖
     * @returns {Array<{originalIndex: number, row: Array<string>}>} 过滤后的 hashSheet，包含原始索引
     */
    getFilteredHashSheet(visitedTables = new Set()) {
        // 如果未启用过滤或没有过滤键配置，返回原始数据及索引
        if (!this.config?.filterEnabled || !this.config?.filterKeys?.length) {
            return this.hashSheet.map((row, index) => ({ originalIndex: index, row }));
        }

        // 检测循环依赖
        if (visitedTables.has(this.uid)) {
            console.warn(`检测到循环依赖：表格 ${this.name} (${this.uid})`);
            return this.hashSheet.map((row, index) => ({ originalIndex: index, row }));
        }

        // 性能监控开始
        const startTime = performance.now();
        const rowCount = this.hashSheet.length;

        // 快速路径：如果没有数据行，直接返回表头
        if (rowCount <= 1) {
            return this.hashSheet.map((row, index) => ({ originalIndex: index, row }));
        }

        // 添加当前表格到已访问集合
        const newVisitedTables = new Set(visitedTables);
        newVisitedTables.add(this.uid);

        // 优化1：预过滤有效的过滤键配置
        const validFilterKeys = [];
        for (const filterKey of this.config.filterKeys) {
            const { sourceColumn, refTableName, refColumn } = filterKey;
            if (sourceColumn && refTableName && refColumn) {
                validFilterKeys.push(filterKey);
            }
        }

        if (validFilterKeys.length === 0) {
            return this.hashSheet.map((row, index) => ({ originalIndex: index, row }));
        }

        // 优化2：预建立允许值映射，使用更高效的数据结构
        const allowedValuesArray = []; // 使用数组替代Map，提升遍历性能
        
        // 批量获取引用表格数据
        for (const filterKey of validFilterKeys) {
            const { sourceColumn, refTableName, refColumn } = filterKey;
            
            // 获取引用表格
            const refTable = this.getTableByName(refTableName);
            if (!refTable) {
                console.warn(`未找到引用表格：${refTableName}`);
                continue;
            }

            // 优化3：直接访问引用表的原始数据
            const refHashSheet = refTable.hashSheet;
            const refCells = refTable.cells;
            
            // 优化4：使用Set进行O(1)查找
            const refValues = new Set();
            
            // 优化5：批量收集值，减少条件判断
            const refRowCount = refHashSheet.length;
            for (let i = 1; i < refRowCount; i++) {
                const cellUid = refHashSheet[i]?.[refColumn];
                if (cellUid) {
                    const cell = refCells.get(cellUid);
                    const value = cell?.data?.value;
                    if (value != null && value !== '') {
                        refValues.add(String(value).trim());
                    }
                }
            }

            if (refValues.size > 0) {
                allowedValuesArray.push({ sourceColumn, allowedValues: refValues });
            }
        }

        // 如果没有有效的过滤值，返回原始数据
        if (allowedValuesArray.length === 0) {
            return this.hashSheet.map((row, index) => ({ originalIndex: index, row }));
        }

        // 优化6：预分配结果数组容量
        const filteredResult = [{ originalIndex: 0, row: this.hashSheet[0] }]; // 保留表头
        
        // 优化7：缓存常用引用，减少属性访问
        const sourceHashSheet = this.hashSheet;
        const sourceCells = this.cells;
        
        // 优化8：使用最高效的过滤算法
        for (let rowIndex = 1; rowIndex < rowCount; rowIndex++) {
            const row = sourceHashSheet[rowIndex];
            
            // 优化9：使用Array.some进行短路求值
            const shouldInclude = allowedValuesArray.some(({ sourceColumn, allowedValues }) => {
                const cellUid = row[sourceColumn];
                if (!cellUid) return false;
                
                const cell = sourceCells.get(cellUid);
                if (!cell) return false;
                
                const cellValue = cell.data.value;
                if (cellValue == null || cellValue === '') return false;
                
                return allowedValues.has(String(cellValue).trim());
            });

            if (shouldInclude) {
                filteredResult.push({ originalIndex: rowIndex, row: row });
            }
        }

        // 性能监控结束
        const endTime = performance.now();
        const duration = endTime - startTime;
        if (duration > 50) { // 降低日志阈值，更好监控性能
            console.log(`过滤表格 "${this.name}" 耗时: ${duration.toFixed(2)}ms, 原始行数: ${rowCount}, 过滤后行数: ${filteredResult.length}`);
        }

        return filteredResult;
    }

    /**
     * 根据 UID 获取表格实例
     * @param {string} uid - 表格的 UID
     * @returns {SheetBase|null} 表格实例
     */
    getTableByUid(uid) {
        // 需要从全局管理器获取表格实例
        // 注意：这个方法需要在 Sheet 子类中重写，以便正确访问 BASE 管理器
        console.warn('getTableByUid 方法需要在 Sheet 子类中实现');
        return null;
    }

    /**
     * 根据 Name 获取表格实例
     * @param {string} name - 表格的 Name
     * @returns {SheetBase|null} 表格实例
     */
    getTableByName(name) {
        // 需要从全局管理器获取表格实例
        // 注意：这个方法需要在 Sheet 子类中重写，以便正确访问 BASE 管理器
        console.warn('getTableByName 方法需要在 Sheet 子类中实现');
        return null;
    }

    /**
     * 获取过滤后的CSV内容 - 优化版本
     * @param {boolean} removeHeader - 是否移除表头
     * @param {string} key - 数据键
     * @param {boolean} useFilter - 是否使用过滤
     * @returns {string} CSV内容
     */
    getSheetCSVFiltered(removeHeader = true, key = 'value', useFilter = true) {
        if (this.isEmpty()) return '（此表格当前为空）\n';

        const filteredData = useFilter ? this.getFilteredHashSheet() : this.hashSheet.map((row, index) => ({ originalIndex: index, row }));

        // 优化：预分配字符串数组，减少字符串拼接开销
        const rows = [];
        const startIndex = removeHeader ? 1 : 0;
        const cellsMap = this.cells; // 缓存引用

        for (let i = startIndex; i < filteredData.length; i++) {
            const { originalIndex, row } = filteredData[i];
            const columns = [];

            for (let j = 0; j < row.length; j++) {
                const cellUid = row[j];
                const cell = cellsMap.get(cellUid);
                if (!cell) {
                    columns.push("");
                } else {
                    // 使用原始索引
                    columns.push(cell.type === Cell.CellType.row_header ? originalIndex : cell.data[key]);
                }
            }

            rows.push(columns.join(','));
        }

        return rows.join('\n') + "\n";
    }
}
