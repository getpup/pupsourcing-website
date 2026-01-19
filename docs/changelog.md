# Changelog

## v1.1.0 - 2026-01-19

### New Features

- **RunModeOneOff for Projection Testing** - Added `RunModeOneOff` to enable synchronous projection processing for integration tests. Projections now support two modes:
  - `RunModeContinuous` (default) - Production mode that runs forever
  - `RunModeOneOff` - Testing mode that processes available events and exits cleanly
  
  This makes integration testing significantly easier and more deterministic. See the [One-Off Projection Processing guide](./projections.md#one-off-projection-processing) for details.

### Improvements

- All projection processors (postgres, mysql, sqlite) support the new run mode
- Comprehensive integration test examples added
- No breaking changes - fully backward compatible

## Previous Releases

See the [GitHub Releases page](https://github.com/getpup/pupsourcing/releases) for information about earlier versions.
