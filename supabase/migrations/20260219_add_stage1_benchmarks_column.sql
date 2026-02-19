-- Add stage1_benchmarks column to strategy_data table for storing benchmark data and WACC
ALTER TABLE strategy_data ADD COLUMN stage1_benchmarks JSONB;

-- Comment describing the column structure
COMMENT ON COLUMN strategy_data.stage1_benchmarks IS 'Stage1 benchmark data and WACC information. Structure: { industryMedian?, competitorA?, competitorB?, waccManual?, waccRationale? }';
