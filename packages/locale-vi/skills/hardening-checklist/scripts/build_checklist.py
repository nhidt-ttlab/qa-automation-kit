#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinh file Excel Hardening Test Checklist theo template chuẩn của team.

Usage:
    python3 build_checklist.py spec.json -o output.xlsx
    python3 build_checklist.py spec.json -o output.xlsx --strict
    python3 build_checklist.py spec.json -o output.xlsx --template path.xlsx

Script tự động:
  - Dựng sheet checklist đúng font Tahoma 10 / header xanh / freeze pane / auto filter
  - Tô đỏ ô Priority của case P1, tô vàng ô Note của dòng "Cần confirm"
  - Đánh số thứ tự bằng công thức, bỏ qua dòng tiêu đề nhóm
  - Sinh Case ID TC_<SCREEN_CODE>_<SEQ> khi bật chế độ extended
  - Điền sheet FunctionList
  - Chạy Quality Gate (Reject Conditions) trước khi ghi file

Xem references/dinh-dang-json.md để biết schema của spec.json.
Xem references/quality-gate.md để biết ý nghĩa từng lỗi Quality Gate.
"""
import argparse
import json
import os
import re
import shutil
import sys
import unicodedata

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.join(HERE, '..', 'assets', 'ProjectCode_IT_TestChecklist.xlsx')

# --- FALLBACK ---
# Layout cột CHUẨN được đọc trực tiếp từ sheet `Common` của template (xem
# read_template_layout). Hai bộ dưới đây CHỈ dùng khi template không có sheet
# `Common` để suy ra layout (vd truyền --template lạ) hoặc khi không có file
# template .xlsx. Không sửa ở đây để đổi format file gen ra — sửa trực tiếp
# template trong assets/.

# --- Bộ cột mặc định (fallback, 12 cột — khớp assets/ProjectCode_IT_TestChecklist - Common.md) ---
BASE_COLUMNS = [
    ('#', 'stt', 6.1),
    ('Screen', 'screen', 22),
    ('Category', 'category', 22),
    ('Sub-Category', 'sub_category', 26),
    ('Business Rule / Checklist', 'rule', 64),
    ('Test Data (if needed)', 'test_data', 26),
    ('Expected Result', 'expected', 54),
    ('Impact', 'impact', 46),
    ('Priority', 'priority', 10),
    ('Test result', 'test_result', 12),
    ('Link redmine', 'link_redmine', 16),
    ('Note', 'note', 34),
]

# --- Bộ cột extended (14 cột): thêm Case ID và Precondition theo chuẩn RBT ---
EXTENDED_COLUMNS = [
    ('#', 'stt', 6.1),
    ('Case ID', 'id', 20),
    ('Screen', 'screen', 20),
    ('Category', 'category', 22),
    ('Sub-Category', 'sub_category', 26),
    ('Business Rule / Checklist', 'rule', 60),
    ('Precondition', 'precondition', 30),
    ('Test Data (if needed)', 'test_data', 26),
    ('Expected Result', 'expected', 52),
    ('Impact', 'impact', 44),
    ('Priority', 'priority', 10),
    ('Test result', 'test_result', 12),
    ('Link redmine', 'link_redmine', 16),
    ('Note', 'note', 32),
]

# Ánh xạ tiêu đề cột trong template -> key ngữ nghĩa dùng để đổ dữ liệu.
# Nhờ bảng này, layout cột được LẤY TỪ template (sheet Common) chứ không hard-code,
# nên khi team đổi template (đổi tên/thêm/bớt cột) thì file gen ra tự bám theo.
# Cột có key nhưng không có dữ liệu trong spec (vd test_result, link_redmine) sẽ
# được ghi rỗng — đúng bản chất cột điền lúc chạy test.
HEADER_KEY_MAP = {
    '#': 'stt',
    'screen': 'screen',
    'category': 'category',
    'sub-category': 'sub_category',
    'sub category': 'sub_category',
    'business rule / checklist': 'rule',
    'business rule/checklist': 'rule',
    'test data (if needed)': 'test_data',
    'test data': 'test_data',
    'expected result': 'expected',
    'impact': 'impact',
    'priority': 'priority',
    'test result': 'test_result',
    'link redmine': 'link_redmine',
    'note': 'note',
    'case id': 'id',
    'precondition': 'precondition',
}
DEFAULT_COL_WIDTH = 15.0

CONFIRM_KEY = 'Cần confirm'
VALID_PRIORITIES = ('P1', 'P2', 'P3')
EXTENDED_ONLY_KEYS = ('precondition', 'id')

# Từ mơ hồ bị cấm trong Expected Result (xem references/quality-gate.md).
# Expected Result phải nêu kết quả quan sát được, không dùng các cụm chung chung này.
VAGUE_PHRASES = [
    'hoạt động đúng', 'hoạt động bình thường', 'hoạt động tốt', 'hoạt động chính xác',
    'chạy đúng', 'chạy tốt', 'chạy bình thường',
    'đúng như mong đợi', 'như mong đợi', 'như kỳ vọng',
    'đúng yêu cầu', 'đúng nghiệp vụ', 'đúng logic',
    'không có lỗi', 'không lỗi', 'không bị lỗi',
    'works correctly', 'functions properly', 'behaves as expected',
    'successfully', 'properly',
]

# Từ chỉ bị cấm khi đứng gần như một mình (Expected Result quá ngắn, không nêu gì cụ thể)
VAGUE_STANDALONE = ['thành công', 'chính xác', 'đúng', 'ok', 'pass', 'bình thường']
STANDALONE_MAX_LEN = 25

# Ngưỡng độ dài Expected Result: dưới ngưỡng mà chứa từ mơ hồ → ERROR, trên ngưỡng → WARNING
VAGUE_ERROR_MAX_LEN = 60

# Cặp trạng thái đối lập - không được gộp trong cùng 1 case (Anti-pattern 9.2)
OPPOSITE_PAIRS = [
    ('enable', 'disable'),
    ('hiển thị', 'ẩn'),
    ('cho phép sửa', 'không cho sửa'),
    ('bật', 'tắt'),
]

HEAD_FILL = PatternFill('solid', fgColor='FFCCFFCC')
GRP_FILL = PatternFill('solid', fgColor='FFDDEBF7')
CONFIRM_FILL = PatternFill('solid', fgColor='FFFFF2CC')
P1_FILL = PatternFill('solid', fgColor='FFFFC7CE')
THIN = Side(style='thin')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
F_TITLE = Font(name='Tahoma', size=18, bold=True)
F_SUB = Font(name='Tahoma', size=9, italic=True, color='FF808080')
F_HEAD = Font(name='Tahoma', size=10, bold=True)
F_BODY = Font(name='Tahoma', size=10)
F_GRP = Font(name='Tahoma', size=10, bold=True, color='FF1F4E79')

DEFAULT_SCOPE_NOTE = (
    'Phạm vi: Hardening - chỉ kiểm thử Business Rule & Impact. '
    'Đã loại bỏ các case UI/UX, hiển thị, tìm kiếm/lọc/sắp xếp/phân trang, '
    'export, điều hướng, responsive, đa trình duyệt, hiệu năng.'
)

# Dropdown + màu nền cho cột "Test result" — khớp cấu hình trạng thái của team.
# (label, mã nền RRGGBB, mã chữ RRGGBB). Override được qua:
#   spec["meta"]["test_result_options"] = [["Pass","017F41","FFFFFF"], ...]
TEST_RESULT_OPTIONS = [
    ('Pass',     '017F41', 'FFFFFF'),
    ('Fail',     'B30000', 'FFFFFF'),
    ('Not test', 'E7E9ED', '000000'),
    ('Pending',  'FEC6A4', '000000'),
    ('Blocked',  '753200', 'FFFFFF'),
    ('Testing',  '3B38B2', 'FFFFFF'),
]


def apply_result_dropdown(ws, col_letter, first_row, last_row, options):
    """Gắn dropdown (data validation list) + tô màu theo giá trị cho 1 cột.

    - Dropdown: chọn 1 trong các trạng thái, cho phép để trống.
    - Tô màu: dùng conditional formatting nên đổi màu tự động theo giá trị,
      hoạt động cả khi mở file bằng Excel lẫn Google Sheets.
    """
    if last_row < first_row:
        return
    rng = f'{col_letter}{first_row}:{col_letter}{last_row}'
    labels = [o[0] for o in options]
    dv = DataValidation(
        type='list', formula1='"%s"' % ','.join(labels), allow_blank=True)
    dv.error = 'Chỉ được chọn 1 trong: ' + ', '.join(labels)
    dv.errorTitle = 'Giá trị không hợp lệ'
    dv.prompt = 'Chọn trạng thái test'
    ws.add_data_validation(dv)
    dv.add(rng)
    for label, bg, fg in options:
        rule = CellIsRule(
            operator='equal',
            formula=['"%s"' % label],
            fill=PatternFill('solid', fgColor=bg),
            font=Font(name='Tahoma', size=10, color=fg))
        ws.conditional_formatting.add(rng, rule)


# ---------------------------------------------------------------- helpers

def strip_accents(text):
    """Bỏ dấu tiếng Việt để sinh mã màn hình viết hoa không dấu."""
    text = text.replace('Đ', 'D').replace('đ', 'd')
    nfkd = unicodedata.normalize('NFD', text)
    return ''.join(c for c in nfkd if unicodedata.category(c) != 'Mn')


def make_screen_code(sheet_def, max_len=16):
    """Sinh mã màn hình dùng cho Case ID: ưu tiên screen_code khai trong spec.

    Tên dài quá max_len sẽ được viết tắt bằng chữ cái đầu mỗi từ
    (vd "Hợp đồng mua hàng (Dự án)" -> "HDMHDA").
    """
    code = (sheet_def.get('screen_code') or '').strip()
    if code:
        return code
    base = sheet_def.get('screen') or sheet_def.get('sheet_name') or 'SCREEN'
    code = re.sub(r'[^A-Z0-9]+', '_', strip_accents(base).upper()).strip('_')
    if len(code) > max_len:
        code = ''.join(tok[0] for tok in code.split('_') if tok)
    return code or 'SCREEN'


def norm_priority(value):
    """Chuẩn hóa Priority: bỏ khoảng trắng, viết hoa. 'p1 ' -> 'P1'."""
    return str(value or '').strip().upper()


def _norm_header(text):
    """Chuẩn hóa tiêu đề cột để tra HEADER_KEY_MAP: lower + gộp khoảng trắng."""
    return re.sub(r'\s+', ' ', str(text or '').strip().lower())


def read_template_layout(wb, header_row=4):
    """Đọc layout cột từ sheet `Common` của template — NGUỒN CỘT DUY NHẤT.

    Trả về dict {columns, header_fill, header_font, title_font, header_row}
    hoặc None nếu template không có sheet `Common` để suy ra layout (khi đó
    build_sheet dùng BASE_COLUMNS / EXTENDED_COLUMNS làm fallback).

    columns: list (header, key, width) đúng thứ tự cột trong template.
    """
    ws = wb['Common'] if 'Common' in wb.sheetnames else None
    if ws is None:
        return None

    def _is_header_row(r):
        vals = [_norm_header(ws.cell(r, c).value) for c in range(1, 4)]
        return '#' in vals or 'screen' in vals

    if not _is_header_row(header_row):
        for r in range(1, 11):
            if _is_header_row(r):
                header_row = r
                break
        else:
            return None

    columns, used_keys = [], set()
    for c in range(1, ws.max_column + 1):
        raw = ws.cell(header_row, c).value
        if raw is None or str(raw).strip() == '':
            if columns:  # gặp cột trống sau khi đã bắt được header -> hết vùng cột
                break
            continue
        header = str(raw).strip()
        key = HEADER_KEY_MAP.get(_norm_header(header))
        if not key:  # cột lạ ngoài map -> key tự sinh, dữ liệu để trống
            slug = re.sub(r'[^a-z0-9]+', '_', _norm_header(header)).strip('_')
            key = 'x_' + (slug or f'col{c}')
        if key in used_keys:
            key = f'{key}_{c}'
        used_keys.add(key)
        letter = get_column_letter(c)
        width = ws.column_dimensions[letter].width or DEFAULT_COL_WIDTH
        columns.append((header, key, round(float(width), 2)))

    if not columns:
        return None

    hc = ws.cell(header_row, 1)
    fg = hc.fill.fgColor.rgb if (hc.fill and hc.fill.patternType) else None
    header_fill = (PatternFill('solid', fgColor=fg)
                   if isinstance(fg, str) and len(fg) in (6, 8) else HEAD_FILL)
    hf = hc.font
    header_font = Font(name=hf.name or 'Tahoma', size=hf.size or 10, bold=True)
    tf = ws.cell(1, 1).font
    title_font = Font(name=tf.name or 'Tahoma', size=tf.size or 18, bold=True)

    return {'columns': columns, 'header_fill': header_fill,
            'header_font': header_font, 'title_font': title_font,
            'header_row': header_row}


def _add_extended_columns(columns):
    """Chèn Case ID + Precondition vào layout lấy từ template (chế độ extended)."""
    cols = list(columns)
    keys = {k for _, k, _ in cols}
    if 'id' not in keys:
        stt_i = next((i for i, (_, k, _) in enumerate(cols) if k == 'stt'), -1)
        cols.insert(stt_i + 1, ('Case ID', 'id', 20))
    if 'precondition' not in keys:
        rule_i = next((i for i, (_, k, _) in enumerate(cols) if k == 'rule'),
                      len(cols) - 1)
        cols.insert(rule_i + 1, ('Precondition', 'precondition', 30))
    return cols


def sheet_columns(sheet_def, template_layout=None):
    """Layout cột: ưu tiên đọc từ template; fallback về hằng số nếu không có Common.

    - Có template_layout: dùng layout template. Nếu extended -> chèn thêm
      Case ID + Precondition lên trên layout đó.
    - Không có template_layout: dùng BASE_COLUMNS / EXTENDED_COLUMNS như cũ.
    """
    if template_layout:
        base = template_layout['columns']
        return _add_extended_columns(base) if sheet_def.get('extended') else base
    return EXTENDED_COLUMNS if sheet_def.get('extended') else BASE_COLUMNS


# Dấu hiệu case liên quan công thức / khoảng giá trị -> bắt buộc có Test Data cụ thể
NUMERIC_HINTS = [
    'công thức', 'lũy kế', 'tổng ', 'biên', 'khoảng', 'min', 'max',
    'khối lượng', 'giá trị', 'đơn giá', 'tỷ giá', 'thành tiền', 'vat',
    'số lượng', 'làm tròn', 'chênh lệch', 'vượt', 'không được lớn hơn',
    'không được nhỏ hơn', '>=', '<=', '>', '<', '=', '%',
]


def _looks_numeric(rule):
    low = rule.lower()
    return any(h in low for h in NUMERIC_HINTS)


# ---------------------------------------------------------------- quality gate

def lint_case(case, ctx, extended, errors, warnings):
    """Kiểm tra 1 case theo Reject Conditions. Xem references/quality-gate.md."""
    where = f"[{ctx}] {case.get('sub_category') or case.get('category') or '(không rõ)'}"

    rule = (case.get('rule') or '').strip()
    expected = (case.get('expected') or '').strip()
    impact = (case.get('impact') or '').strip()
    priority = norm_priority(case.get('priority'))
    test_data = (case.get('test_data') or '').strip()
    note = (case.get('note') or '').strip()

    # --- ERROR: các điều kiện reject bắt buộc ---
    if not rule:
        errors.append(f'{where}: thiếu Business Rule / Checklist')
    if not expected:
        errors.append(f'{where}: thiếu Expected Result')
    if not impact:
        errors.append(f'{where}: thiếu Impact (bắt buộc với checklist hardening)')
    if priority not in VALID_PRIORITIES:
        errors.append(
            f'{where}: Priority "{case.get("priority")}" không hợp lệ, phải là P1/P2/P3')
    if not test_data:
        errors.append(f'{where}: thiếu Test Data — ghi "N/A" nếu case không cần dữ liệu')

    low_expected = expected.lower()
    for phrase in VAGUE_PHRASES:
        if phrase in low_expected:
            msg = (f'{where}: Expected Result dùng từ mơ hồ "{phrase}" — '
                   f'phải nêu kết quả quan sát được')
            if len(expected) < VAGUE_ERROR_MAX_LEN:
                errors.append(msg)
            else:
                warnings.append(msg + ' (kiểm tra lại phần mô tả)')
            break
    else:
        if len(expected) <= STANDALONE_MAX_LEN:
            stripped = re.sub(r'[^\wÀ-ỹ\s]', '', low_expected).strip()
            for word in VAGUE_STANDALONE:
                if stripped == word or stripped.startswith(word + ' ') or stripped.endswith(' ' + word):
                    errors.append(
                        f'{where}: Expected Result chỉ ghi "{expected}" — '
                        f'phải nêu kết quả cụ thể, quan sát được')
                    break

    # --- ERROR: chuỗi bắt đầu bằng "=" bị openpyxl/Excel ghi thành công thức -> #N/A, #NAME? ---
    for key, value in case.items():
        if isinstance(value, str) and value.startswith('='):
            errors.append(
                f'{where}: "{key}" bắt đầu bằng "=" nên sẽ bị ghi thành công thức Excel '
                f'(ra #N/A / #NAME?) — viết "Công thức: …" thay vì "= …"')

    # --- ERROR: khai trường extended nhưng chưa bật extended ---
    if not extended:
        for key in EXTENDED_ONLY_KEYS:
            if (case.get(key) or '').strip():
                errors.append(
                    f'{where}: có khai "{key}" nhưng sheet chưa bật "extended": true — '
                    f'dữ liệu này sẽ KHÔNG được ghi ra file')

    # --- WARNING: dấu hiệu vi phạm nguyên tắc viết case ---
    if rule.lower().startswith(('kiểm tra', 'check', 'verify', 'test ')):
        warnings.append(
            f'{where}: Business Rule đang phát biểu THAO TÁC ("{rule[:40]}...") — '
            f'hãy phát biểu RULE nghiệp vụ')

    if priority == 'P1' and test_data.upper() == 'N/A' and _looks_numeric(rule):
        warnings.append(
            f'{where}: case P1 về công thức/khoảng giá trị nhưng Test Data = N/A — '
            f'nên ghi giá trị cụ thể kèm biên')

    for a, b in OPPOSITE_PAIRS:
        if a in low_expected and b in low_expected:
            warnings.append(
                f'{where}: Expected Result gộp 2 trạng thái đối lập ("{a}" và "{b}") — '
                f'nên tách thành 2 case')
            break

    if CONFIRM_KEY in note and CONFIRM_KEY not in expected and len(expected) < 25:
        warnings.append(f'{where}: đánh dấu "Cần confirm" nhưng Expected Result quá ngắn')


def lint_spec(spec):
    """Kiểm tra toàn bộ spec. Trả về (errors, warnings)."""
    errors, warnings = [], []

    sheets = spec.get('sheets')
    if not isinstance(sheets, list) or not sheets:
        errors.append('spec.json: thiếu danh sách "sheets" hoặc danh sách rỗng')
        return errors, warnings

    seen_sheets = set()
    seen_ids = {}

    for i, sheet_def in enumerate(sheets):
        sname = (sheet_def.get('sheet_name') or '').strip()
        if not sname:
            errors.append(f'sheets[{i}]: thiếu "sheet_name"')
            continue
        if sname in seen_sheets:
            errors.append(
                f'sheet_name trùng: "{sname}" — Excel sẽ tự đổi tên sheet thứ 2 '
                f'và số liệu FunctionList sẽ sai')
            continue
        seen_sheets.add(sname)

        if len(sname) > 31:
            errors.append(f'[{sname}]: tên sheet dài quá 31 ký tự, Excel không cho phép')
        bad = set(sname) & set('[]:*?/\\')
        if bad:
            errors.append(f'[{sname}]: tên sheet chứa ký tự Excel cấm {sorted(bad)}')

        extended = bool(sheet_def.get('extended'))
        groups = sheet_def.get('groups')
        if not isinstance(groups, list) or not groups:
            errors.append(f'[{sname}]: thiếu "groups" hoặc không có group nào')
            continue

        for j, group in enumerate(groups):
            gname = (group.get('name') or '').strip()
            if not gname:
                warnings.append(f'[{sname}] groups[{j}]: thiếu "name"')
                gname = f'(group {j})'
            cases = group.get('cases')
            if not isinstance(cases, list) or not cases:
                warnings.append(f'[{sname}] {gname}: group rỗng, không có case')
                continue
            for case in cases:
                if not isinstance(case, dict):
                    errors.append(f'[{sname}] {gname}: có phần tử case không phải object')
                    continue
                lint_case(case, f'{sname} / {gname}', extended, errors, warnings)
                cid = (case.get('id') or '').strip()
                if cid:
                    if cid in seen_ids:
                        errors.append(f'Case ID trùng: {cid}')
                    seen_ids[cid] = True

    return errors, warnings


# ---------------------------------------------------------------- build

def build_sheet(wb, sheet_def, generated_ids, warnings, template_layout=None,
                test_result_options=None):
    name = sheet_def['sheet_name']
    columns = sheet_columns(sheet_def, template_layout)
    ncol = len(columns)
    idx = {key: i + 1 for i, (_, key, _) in enumerate(columns)}

    # Style header/title bám theo template nếu đọc được; nếu không, dùng mặc định.
    title_font = template_layout['title_font'] if template_layout else F_TITLE
    head_fill = template_layout['header_fill'] if template_layout else HEAD_FILL
    head_font = template_layout['header_font'] if template_layout else F_HEAD

    ws = wb.create_sheet(name)
    ws.sheet_properties.tabColor = sheet_def.get('tab_color', 'FF2E75B6')
    ws['A1'] = sheet_def.get('title', name)
    ws['A1'].font = title_font
    ws['A2'] = sheet_def.get('scope_note', DEFAULT_SCOPE_NOTE)
    ws['A2'].font = F_SUB

    for i, (header, _, width) in enumerate(columns, start=1):
        c = ws.cell(4, i, header)
        c.font = head_font
        c.fill = head_fill
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c.border = BORDER
        ws.column_dimensions[get_column_letter(i)].width = width

    screen = sheet_def.get('screen', '')
    screen_code = make_screen_code(sheet_def)
    centered = {idx[k] for k in ('stt', 'priority', 'id') if k in idx}

    r = 5
    seq = 0
    n_group_rows = 0  # số dòng tiêu đề nhóm phía trên, dùng để đánh số case cho đúng
    count = {'total': 0, 'p1': 0, 'p2': 0, 'p3': 0, 'confirm': 0}

    for group in sheet_def['groups']:
        ws.cell(r, 1, group.get('name', ''))
        for i in range(1, ncol + 1):
            cell = ws.cell(r, i)
            cell.font = F_GRP
            cell.fill = GRP_FILL
            cell.border = BORDER
            cell.alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=ncol)
        ws.row_dimensions[r].height = 20
        r += 1
        n_group_rows += 1

        for case in group.get('cases') or []:
            seq += 1
            priority = norm_priority(case.get('priority')) or 'P2'
            note = case.get('note', '')

            values = {
                'screen': case.get('screen', screen),
                'category': case.get('category', ''),
                'sub_category': case.get('sub_category', ''),
                'rule': case.get('rule', ''),
                'precondition': case.get('precondition', ''),
                'test_data': case.get('test_data', ''),
                'expected': case.get('expected', ''),
                'impact': case.get('impact', ''),
                'priority': priority,
                'test_result': case.get('test_result', ''),
                'link_redmine': case.get('link_redmine', ''),
                'note': note,
            }
            if 'id' in idx:
                cid = (case.get('id') or '').strip() or f'TC_{screen_code}_{seq:03d}'
                if cid in generated_ids:
                    warnings.append(f'[{name}] Case ID trùng sau khi sinh tự động: {cid}')
                generated_ids.add(cid)
                values['id'] = cid

            # đánh số case, bỏ qua các dòng tiêu đề nhóm phía trên
            if 'stt' in idx:
                ws.cell(r, idx['stt'], f'=ROW()-{4 + n_group_rows}')
            for key, col in idx.items():
                if key == 'stt':
                    continue
                ws.cell(r, col, values.get(key, ''))

            for i in range(1, ncol + 1):
                cell = ws.cell(r, i)
                cell.font = F_BODY
                cell.border = BORDER
                if i in centered:
                    cell.alignment = Alignment(horizontal='center', vertical='center')
                else:
                    cell.alignment = Alignment(horizontal='left', vertical='top', wrap_text=True)

            if priority == 'P1' and 'priority' in idx:
                ws.cell(r, idx['priority']).fill = P1_FILL
            if priority in VALID_PRIORITIES:
                count[priority.lower()] += 1
            if CONFIRM_KEY in str(note) and 'note' in idx:
                ws.cell(r, idx['note']).fill = CONFIRM_FILL
                count['confirm'] += 1
            count['total'] += 1
            r += 1

    ws.freeze_panes = 'A5'
    ws.auto_filter.ref = f'A4:{get_column_letter(ncol)}{r - 1}'

    # Gắn dropdown + tô màu cho cột Test result (nếu template có cột này)
    if 'test_result' in idx and r > 5:
        apply_result_dropdown(
            ws, get_column_letter(idx['test_result']), 5, r - 1,
            test_result_options or TEST_RESULT_OPTIONS)

    # cột dùng để đếm Total ở FunctionList = cột Business Rule (fallback: cột E)
    count['rule_col'] = get_column_letter(idx.get('rule', 5))
    return count


def fill_function_list(wb, spec, stats):
    if 'FunctionList' not in wb.sheetnames:
        return
    fl = wb['FunctionList']
    meta = spec.get('meta', {})
    for cell, key in (('C3', 'project_name'), ('C4', 'project_code'),
                      ('C5', 'version'), ('C6', 'test_environment')):
        if meta.get(key):
            fl[cell] = meta[key]

    row = 9
    for sheet_def in spec['sheets']:
        name = sheet_def.get('sheet_name')
        if name not in stats:
            continue
        col = stats[name]['rule_col']
        fl.cell(row, 3, sheet_def.get('epic', ''))
        fl.cell(row, 4, sheet_def.get('module_name', name))
        fl.cell(row, 5, sheet_def.get('pic', ''))
        fl.cell(row, 6, sheet_def.get('status', 'Not Started'))
        fl.cell(row, 7, f"=COUNTA('{name}'!{col}5:{col}1000)")
        fl.cell(row, 8, sheet_def.get('note', ''))
        for c in range(2, 9):
            fl.cell(row, c).font = F_BODY
        row += 1


def main():
    ap = argparse.ArgumentParser(
        description='Sinh file Excel Hardening Test Checklist từ spec.json')
    ap.add_argument('spec', help='đường dẫn file spec.json')
    ap.add_argument('-o', '--output', required=True, help='đường dẫn file .xlsx xuất ra')
    ap.add_argument('--template', default=DEFAULT_TEMPLATE, help='template gốc của team')
    ap.add_argument('--keep-common', action='store_true',
                    help='giữ lại sheet Common của template')
    ap.add_argument('--strict', action='store_true',
                    help='dừng và không xuất file nếu Quality Gate phát hiện lỗi')
    args = ap.parse_args()

    with open(args.spec, encoding='utf-8') as f:
        spec = json.load(f)

    # ---- Quality Gate ----
    errors, warnings = lint_spec(spec)
    if errors and args.strict:
        print('LỖI Quality Gate (Reject Conditions):', file=sys.stderr)
        for e in errors:
            print(f'  x {e}', file=sys.stderr)
        print(f'\nDỪNG: {len(errors)} lỗi. Sửa spec.json rồi chạy lại '
              f'(hoặc bỏ --strict để vẫn xuất file).', file=sys.stderr)
        sys.exit(1)

    # lỗi cấu trúc nặng thì không dựng file được, dừng kể cả khi không --strict
    fatal = [e for e in errors if 'thiếu danh sách "sheets"' in e or 'sheet_name trùng' in e
             or 'thiếu "groups"' in e or 'thiếu "sheet_name"' in e]

    out_dir = os.path.dirname(os.path.abspath(args.output))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    if os.path.isfile(args.template):
        shutil.copy(args.template, args.output)
        wb = openpyxl.load_workbook(args.output)
    else:
        # Không có file template .xlsx (vd repo chỉ giữ bản Markdown trong assets/):
        # dựng workbook trống với bộ cột fallback, không có Cover/FunctionList/History.
        warnings.append(
            f'Không tìm thấy template "{args.template}" — tạo workbook trống với bộ cột '
            f'fallback 12 cột (không có sheet Cover/FunctionList/History). '
            f'Truyền --template <file.xlsx> để dùng template của team.')
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
    # Đọc layout cột từ sheet Common TRƯỚC khi xoá nó — đây là nguồn format chuẩn.
    template_layout = read_template_layout(wb)
    if template_layout is None:
        warnings.append(
            'Template không có sheet "Common" hợp lệ để lấy layout cột — '
            'dùng bộ cột fallback trong script (có thể lệch template team).')
    if not args.keep_common and 'Common' in wb.sheetnames:
        del wb['Common']

    stats = {}
    generated_ids = set()
    built = set()
    # Cho phép override danh sách trạng thái + màu qua meta (nếu không thì dùng mặc định)
    tr_opts = spec.get('meta', {}).get('test_result_options')
    if tr_opts:
        try:
            tr_opts = [(o[0], o[1], o[2] if len(o) > 2 else '000000') for o in tr_opts]
        except (TypeError, IndexError):
            warnings.append('meta.test_result_options sai định dạng — dùng danh sách mặc định')
            tr_opts = None
    for sheet_def in spec.get('sheets', []):
        name = (sheet_def.get('sheet_name') or '').strip()
        if not name or name in built or not sheet_def.get('groups'):
            continue
        built.add(name)
        stats[name] = build_sheet(wb, sheet_def, generated_ids, warnings,
                                  template_layout, tr_opts)

    fill_function_list(wb, spec, stats)
    wb.save(args.output)

    if warnings:
        print('CẢNH BÁO Quality Gate:', file=sys.stderr)
        for w in warnings:
            print(f'  ! {w}', file=sys.stderr)
    if errors:
        print('LỖI Quality Gate (Reject Conditions):', file=sys.stderr)
        for e in errors:
            print(f'  x {e}', file=sys.stderr)
        print(f'\n=> {len(errors)} lỗi cần sửa trong spec.json. '
              f'File vẫn được xuất; chạy lại với --strict để chặn.', file=sys.stderr)

    for s in stats.values():
        s.pop('rule_col', None)
    summary = {
        'output': args.output,
        'sheets': stats,
        'total_cases': sum(s['total'] for s in stats.values()),
        'p1': sum(s['p1'] for s in stats.values()),
        'p2': sum(s['p2'] for s in stats.values()),
        'p3': sum(s['p3'] for s in stats.values()),
        'need_confirm': sum(s['confirm'] for s in stats.values()),
        'quality_gate': {'errors': len(errors), 'warnings': len(warnings),
                         'fatal': len(fatal)},
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print('\nBước tiếp theo (BẮT BUỘC): verify công thức — xem references/quality-gate.md mục 3\n'
          '  1. Quality Gate ở trên phải 0 lỗi (không chuỗi nào bắt đầu bằng "=")\n'
          f'  2. Mở {args.output} bằng Excel / LibreOffice Calc / Google Sheets: cột # và Total\n'
          '     ở FunctionList ra số, không ô nào #N/A / #NAME? / #REF! / #VALUE!', file=sys.stderr)


if __name__ == '__main__':
    main()
