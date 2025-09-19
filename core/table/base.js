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
            filterKeys: []                     // 过滤键配置数组 [{sourceColumn: 1, refTableUid: 'sheet_xxx', refColumn: 1}]
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
     * 获取过滤后的 hashSheet
     * @param {Set} visitedTables - 已访问的表格集合，用于检测循环依赖
     * @param {boolean} useCache - 是否使用缓存
     * @returns {Array} 过滤后的 hashSheet
     */
    getFilteredHashSheet(visitedTables = new Set(), useCache = true) {
        // 如果未启用过滤或没有过滤键配置，返回原始数据
        if (!this.config?.filterEnabled || !this.config?.filterKeys?.length) {
            return this.hashSheet;
        }

        // 检测循环依赖
        if (visitedTables.has(this.uid)) {
            console.warn(`检测到循环依赖：表格 ${this.name} (${this.uid})`);
            return this.hashSheet;
        }

        // 缓存机制（带版本控制的智能缓存）
        if (useCache && this._filteredHashSheetCache && this._filterCacheVersion === this._dataVersion) {
            return this._filteredHashSheetCache;
        }

        // 性能监控开始
        const startTime = performance.now();
        const rowCount = this.hashSheet.length;

        // 添加当前表格到已访问集合
        const newVisitedTables = new Set(visitedTables);
        newVisitedTables.add(this.uid);

        // 收集所有允许的值（OR逻辑）- 优化版本
        const allowedValuesMap = new Map(); // key: sourceColumn, value: Set of allowed values
        
        // 批量处理过滤键配置
        const validFilterKeys = this.config.filterKeys.filter(filterKey => {
            const { sourceColumn, refTableUid, refColumn } = filterKey;
            const isValid = sourceColumn && refTableUid && refColumn;
            if (!isValid) {
                console.warn(`过滤键配置不完整：`, filterKey);
            }
            return isValid;
        });

        // 批量获取引用表格数据
        for (const filterKey of validFilterKeys) {
            const { sourceColumn, refTableUid, refColumn } = filterKey;
            
            // 获取引用表格
            const refTable = this.getTableByUid(refTableUid);
            if (!refTable) {
                console.warn(`未找到引用表格：${refTableUid}`);
                continue;
            }

            // 重要：引用表不应该使用过滤，使用原始数据避免循环过滤
            const refOriginalHashSheet = refTable.hashSheet;
            
            // 优化：使用更高效的值收集方式
            const refValues = new Set();
            const refCells = refTable.cells;
            
            console.log(`过滤键调试 - 引用表 ${refTable.name}(${refTableUid}) 原始数据行数: ${refOriginalHashSheet.length}, 目标列: ${refColumn}`);
            
            // 统一处理逻辑，避免大小数据量处理不一致
            for (let i = 1; i < refOriginalHashSheet.length; i++) {
                const cellUid = refOriginalHashSheet[i]?.[refColumn];
                if (cellUid) {
                    const cell = refCells.get(cellUid);
                    const value = cell?.data?.value;
                    // 统一的值验证逻辑
                    if (value !== undefined && value !== null && value !== '') {
                        const stringValue = String(value).trim(); // 确保转换为字符串并去除空格
                        if (stringValue) {
                            refValues.add(stringValue);
                            console.log(`过滤键调试 - 收集到允许值: "${stringValue}"`);
                        }
                    }
                }
            }

            console.log(`过滤键调试 - 共收集到 ${refValues.size} 个允许值:`, Array.from(refValues));

            // 合并到允许值集合（OR逻辑）
            if (!allowedValuesMap.has(sourceColumn)) {
                allowedValuesMap.set(sourceColumn, new Set());
            }
            const currentSet = allowedValuesMap.get(sourceColumn);
            // 优化：直接合并 Set
            if (refValues.size > 0) {
                refValues.forEach(value => currentSet.add(value));
            }
        }

        // 如果没有有效的过滤值，返回原始数据
        if (allowedValuesMap.size === 0) {
            this._filteredHashSheetCache = this.hashSheet;
            this._filterCacheVersion = this._dataVersion;
            return this.hashSheet;
        }

        // 执行过滤 - 优化版本
        const filteredHashSheet = [this.hashSheet[0]]; // 保留表头
        
        // 预先获取 cells Map 引用，避免重复访问
        const cellsMap = this.cells;
        
        // 统一的过滤算法，避免大小数据量处理不一致
        for (let rowIndex = 1; rowIndex < rowCount; rowIndex++) {
            const row = this.hashSheet[rowIndex];
            let shouldInclude = false;

            // 检查每个配置的源列（OR逻辑）
            for (const [sourceColumn, allowedValues] of allowedValuesMap.entries()) {
                const cellUid = row[sourceColumn];
                if (cellUid) {
                    const cell = cellsMap.get(cellUid);
                    if (cell) {
                        const cellValue = cell.data.value;
                        const stringCellValue = String(cellValue || '').trim(); // 确保转换为字符串并去除空格
                        
                        console.log(`过滤键调试 - 检查行 ${rowIndex}, 列 ${sourceColumn}, 值: "${stringCellValue}", 是否在允许列表中: ${allowedValues.has(stringCellValue)}`);
                        
                        if (stringCellValue && allowedValues.has(stringCellValue)) {
                            shouldInclude = true;
                            console.log(`过滤键调试 - 行 ${rowIndex} 通过过滤`);
                            break;
                        }
                    }
                }
            }

            if (shouldInclude) {
                filteredHashSheet.push(row);
            } else {
                console.log(`过滤键调试 - 行 ${rowIndex} 被过滤掉`);
            }
        }

        // 缓存结果
        this._filteredHashSheetCache = filteredHashSheet;
        this._filterCacheVersion = this._dataVersion || 0;

        // 性能监控结束
        const endTime = performance.now();
        if (endTime - startTime > 100) {
            console.log(`过滤表格 "${this.name}" 耗时: ${(endTime - startTime).toFixed(2)}ms, 原始行数: ${rowCount}, 过滤后行数: ${filteredHashSheet.length}`);
        }

        return filteredHashSheet;
    }

    /**
     * 清除过滤缓存
     */
    clearFilterCache() {
        this._filteredHashSheetCache = null;
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
     * 获取过滤后的CSV内容
     * @param {boolean} removeHeader - 是否移除表头
     * @param {string} key - 数据键
     * @param {boolean} useFilter - 是否使用过滤
     * @returns {string} CSV内容
     */
    getSheetCSVFiltered(removeHeader = true, key = 'value', useFilter = true) {
        if (this.isEmpty()) return '（此表格当前为空）\n';
        
        const targetHashSheet = useFilter ? this.getFilteredHashSheet() : this.hashSheet;
        
        const content = targetHashSheet.slice(removeHeader ? 1 : 0).map((row, index) => row.map(cellUid => {
            const cell = this.cells.get(cellUid);
            if (!cell) return "";
            return cell.type === Cell.CellType.row_header ? index : cell.data[key];
        }).join(',')).join('\n');
        
        return content + "\n";
    }
}
