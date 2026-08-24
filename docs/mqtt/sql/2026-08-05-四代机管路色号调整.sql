-- ============================================================================
-- 四代机管路色号调整（2026-08-05）
-- 机器最新管路：1=33/0  2=0/11  3=0/88  4=0/33  5=0/45  6=0/00  7=3%  8=12%
-- 差异只在 4/5/6 号口（原 4=0/00、5=0/33、6=0/45），本脚本做三处同步：
--   ① config_const.dye_device_cream_config_four —— 下料"几号管"分配 + 首绑建行的口→色号映射
--   ② udream_dye.dye_color_config（畅想模式 NO.4~NO.6）—— App 色板的组合/配比/图标
--   ③ udream_dye.dye_device_cream 存量行 —— 已绑定四代机的余量行色号
-- 每个环境（test/uat/生产）各跑一遍；跑完需刷新 config_const 缓存（见文末说明）。
-- ============================================================================

-- ① 口→色号映射（4→0/33、5→0/45、6→0/00，图片 url 跟着颜色走）
UPDATE udream_basics.config_const
SET `value` = '[{"id":1,"value":"1号口","name":"33/0","desc":"NO.1","url":"https://xq-dev.oss-cn-shenzhen.aliyuncs.com/2023/03/29/12/基础色系/基础色系-色板-3-0.jpg"},{"id":2,"value":"2号口","name":"0/11","desc":"NO.2","url":"http://udream-n.oss-cn-shenzhen.aliyuncs.com/2023/04/07/09/26d405aaa04c48b6bacb91d6732b73cc.png?imgWidth=309&imgHeight=302"},{"id":3,"value":"3号口","name":"0/88","desc":"NO.3","url":"https://xq-dev.oss-cn-shenzhen.aliyuncs.com/2023/03/29/12/基础色系/基础色系-色板-0-88.jpg"},{"id":4,"value":"4号口","name":"0/33","desc":"NO.4","url":"https://xq-dev.oss-cn-shenzhen.aliyuncs.com/2023/03/29/12/基础色系/基础色系-色板-0-33.jpg"},{"id":5,"value":"5号口","name":"0/45","desc":"NO.5","url":"https://xq-dev.oss-cn-shenzhen.aliyuncs.com/2023/03/29/12/基础色系/基础色系-色板-0-45.jpg"},{"id":6,"value":"6号口","name":"0/00","desc":"NO.6","url":"http://udream-n.oss-cn-shenzhen.aliyuncs.com/2023/04/07/09/26d405aaa04c48b6bacb91d6732b73cc.png?imgWidth=309&imgHeight=302"},{"id":7,"value":"7号口","name":"3%","desc":"NO.7","url":""},{"id":8,"value":"8号口","name":"12%","desc":"NO.8","url":""}]'
WHERE `key` = 'dye_device_cream_config_four';

-- ② 畅想模式色板 NO.4/NO.5/NO.6（combination + ratio_json + icon 三者同步轮换；
--    icon 图片内容是画死的颜色，跟着颜色轮换：NO.4←原NO.5图(0/33黄)、NO.5←原NO.6图(0/45红)、NO.6←原NO.4图(0/00白)）
UPDATE udream_dye.dye_color_config
SET combination = '0/33',
    ratio_json  = '[{"name":"0/33","quantity":30}]',
    icon        = 'https://udream-act.oss-cn-shenzhen.aliyuncs.com/app-skin/udream_dye/icon_images/imagine_color_scheme/NO.5.jpg',
    update_time = NOW()
WHERE type = 6 AND model_color_type = 4 AND name = 'NO.4';

UPDATE udream_dye.dye_color_config
SET combination = '0/45',
    ratio_json  = '[{"name":"0/45","quantity":30}]',
    icon        = 'https://udream-act.oss-cn-shenzhen.aliyuncs.com/app-skin/udream_dye/icon_images/imagine_color_scheme/NO.6.jpg',
    update_time = NOW()
WHERE type = 6 AND model_color_type = 4 AND name = 'NO.5';

UPDATE udream_dye.dye_color_config
SET combination = '0/00',
    ratio_json  = '[{"name":"0/00","quantity":30}]',
    icon        = 'https://udream-act.oss-cn-shenzhen.aliyuncs.com/app-skin/udream_dye/icon_images/imagine_color_scheme/NO.4.png',
    update_time = NOW()
WHERE type = 6 AND model_color_type = 4 AND name = 'NO.6';

-- ③【可选】存量四代机余量行的色号（按 device_code 04 前缀圈四代机，含解绑残留行；余量/克数不动，只改名）
--    2026-08-05 起 queryCapacity 的色号已实时取①配置（App 容量监控/PC 容量列均不再依赖行上 name），
--    此段仅作数据卫生订正，不跑也不影响展示；跑了可保持 DB 与配置一致。
UPDATE udream_dye.dye_device_cream
SET name = '0/33', update_time = NOW()
WHERE device_code LIKE '04%' AND is_del = 0 AND device_port = 4 AND name = '0/00';

UPDATE udream_dye.dye_device_cream
SET name = '0/45', update_time = NOW()
WHERE device_code LIKE '04%' AND is_del = 0 AND device_port = 5 AND name = '0/33';

UPDATE udream_dye.dye_device_cream
SET name = '0/00', update_time = NOW()
WHERE device_code LIKE '04%' AND is_del = 0 AND device_port = 6 AND name = '0/45';

-- ============================================================================
-- 核验
-- ============================================================================
-- ①：value 里应看到 4号口=0/33、5号口=0/45、6号口=0/00
SELECT `value` FROM udream_basics.config_const WHERE `key` = 'dye_device_cream_config_four';
-- ②：NO.4=0/33、NO.5=0/45、NO.6=0/00
SELECT name, combination, ratio_json FROM udream_dye.dye_color_config
WHERE type = 6 AND model_color_type = 4 ORDER BY sort;
-- ③：各口色号 = 机器管路；不应再有 4口0/00、5口0/33、6口0/45 的行
SELECT device_code, device_port, name, weight, total_weight FROM udream_dye.dye_device_cream
WHERE device_code LIKE '04%' AND is_del = 0 ORDER BY device_code, device_port;

-- ============================================================================
-- 跑完后的两件事
-- 1. config_const 走缓存（CacheUtil.getConfigConsCache），SQL 直改后需刷新缓存：
--    管理端有配置维护入口的从管理端改①代替 SQL 最稳；否则清对应 Redis 缓存或重启 dye-service。
-- 2. NO.1 的图片仍是老的"3/0"素材（NO.1.jpg / 基础色系-色板-3-0.jpg，数字画在图里），
--    数据已是 33/0，需设计出一张 33/0 的图替换，SQL 管不了图片内容。
-- ============================================================================
