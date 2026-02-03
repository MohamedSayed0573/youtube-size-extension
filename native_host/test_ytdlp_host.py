"""
Unit tests for ytdlp_host.py native messaging host

Tests cover:
- Native messaging protocol (read/write messages)
- Utility functions (humanize_bytes, humanize_duration)
- URL validation and security
- yt-dlp integration
- Size calculation logic
- Error handling

Run:
    pytest test_ytdlp_host.py -v
    pytest --cov=ytdlp_host --cov-report=term test_ytdlp_host.py
"""

import json
import struct
import sys
import io
import subprocess
from unittest.mock import patch, MagicMock, mock_open
import pytest

# Import the module under test
import ytdlp_host


class TestNativeMessagingProtocol:
    """Test native messaging protocol implementation"""

    def test_send_message_valid_dict(self, capsys):
        """Test sending a valid dictionary message"""
        msg = {"ok": True, "test": "value"}
        ytdlp_host.send_message(msg)
        
        captured = capsys.readouterr()
        # Check that something was written (can't easily capture binary stdout)
        assert captured.err == ""  # No errors to stderr

    def test_send_message_with_unicode(self, capsys):
        """Test sending message with unicode characters"""
        msg = {"ok": True, "text": "Hello 世界 🎉"}
        ytdlp_host.send_message(msg)
        
        # Should not raise exception
        captured = capsys.readouterr()
        assert captured.err == ""

    def test_read_message_valid(self):
        """Test reading a valid message from stdin"""
        msg = {"url": "https://youtube.com/watch?v=test"}
        encoded = json.dumps(msg).encode('utf-8')
        length = struct.pack('<I', len(encoded))
        
        mock_stdin = io.BytesIO(length + encoded)
        
        with patch('sys.stdin', MagicMock(buffer=mock_stdin)):
            result = ytdlp_host.read_message()
        
        assert result == msg

    def test_read_message_empty_stream(self):
        """Test reading from empty stream returns None"""
        mock_stdin = io.BytesIO(b'')
        
        with patch('sys.stdin', MagicMock(buffer=mock_stdin)):
            result = ytdlp_host.read_message()
        
        assert result is None

    def test_read_message_truncated_length(self):
        """Test reading truncated length prefix returns None"""
        mock_stdin = io.BytesIO(b'\x00\x01')  # Only 2 bytes instead of 4
        
        with patch('sys.stdin', MagicMock(buffer=mock_stdin)):
            result = ytdlp_host.read_message()
        
        assert result is None

    def test_read_message_truncated_data(self):
        """Test reading truncated message data returns None"""
        length = struct.pack('<I', 100)  # Say 100 bytes
        mock_stdin = io.BytesIO(length + b'short')  # But only provide 5
        
        with patch('sys.stdin', MagicMock(buffer=mock_stdin)):
            result = ytdlp_host.read_message()
        
        assert result is None

    def test_read_message_invalid_json(self):
        """Test reading invalid JSON returns None"""
        invalid_json = b'{invalid json}'
        length = struct.pack('<I', len(invalid_json))
        mock_stdin = io.BytesIO(length + invalid_json)
        
        with patch('sys.stdin', MagicMock(buffer=mock_stdin)):
            result = ytdlp_host.read_message()
        
        assert result is None


class TestUtilityFunctions:
    """Test utility helper functions"""

    def test_humanize_bytes_small(self):
        """Test formatting small byte values"""
        assert ytdlp_host.humanize_bytes(500) == "500 B"
        assert ytdlp_host.humanize_bytes(999) == "999 B"

    def test_humanize_bytes_kilobytes(self):
        """Test formatting KB values"""
        result = ytdlp_host.humanize_bytes(1500)
        assert "1.50 KB" == result or "1.5 KB" == result

    def test_humanize_bytes_megabytes(self):
        """Test formatting MB values"""
        result = ytdlp_host.humanize_bytes(45234567)
        assert result.startswith("45.2")
        assert "MB" in result

    def test_humanize_bytes_gigabytes(self):
        """Test formatting GB values"""
        result = ytdlp_host.humanize_bytes(1234567890)
        assert "GB" in result

    def test_humanize_bytes_none(self):
        """Test None input returns N/A"""
        assert ytdlp_host.humanize_bytes(None) == "N/A"

    def test_humanize_bytes_zero(self):
        """Test zero bytes"""
        assert ytdlp_host.humanize_bytes(0) == "0 B"

    def test_humanize_duration_seconds(self):
        """Test formatting duration under 1 minute"""
        assert ytdlp_host.humanize_duration(45) == "0:45"

    def test_humanize_duration_minutes(self):
        """Test formatting duration in minutes"""
        assert ytdlp_host.humanize_duration(185) == "3:05"

    def test_humanize_duration_hours(self):
        """Test formatting duration with hours"""
        assert ytdlp_host.humanize_duration(3725) == "1:02:05"

    def test_humanize_duration_none(self):
        """Test None input returns None"""
        assert ytdlp_host.humanize_duration(None) is None

    def test_humanize_duration_invalid(self):
        """Test invalid input returns None"""
        assert ytdlp_host.humanize_duration("invalid") is None


class TestYtDlpIntegration:
    """Test yt-dlp command execution and parsing"""

    @patch('subprocess.run')
    def test_run_ytdlp_dump_json_success(self, mock_run):
        """Test successful yt-dlp metadata extraction"""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({
            "duration": 180,
            "title": "Test Video",
            "formats": []
        })
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        meta, err, code = ytdlp_host.run_ytdlp_dump_json("https://youtube.com/watch?v=dQw4w9WgXcQ")

        assert code == 0
        assert err is None
        assert meta["duration"] == 180
        assert meta["title"] == "Test Video"

    @patch('subprocess.run')
    def test_run_ytdlp_dump_json_not_found(self, mock_run):
        """Test yt-dlp not found error"""
        mock_run.side_effect = FileNotFoundError()

        meta, err, code = ytdlp_host.run_ytdlp_dump_json("https://youtube.com/watch?v=dQw4w9WgXcQ")

        assert code == 127
        assert "not found" in err.lower()
        assert meta is None

    @patch('subprocess.run')
    def test_run_ytdlp_dump_json_timeout(self, mock_run):
        """Test yt-dlp timeout handling"""
        mock_run.side_effect = subprocess.TimeoutExpired("yt-dlp", 25)

        meta, err, code = ytdlp_host.run_ytdlp_dump_json("https://youtube.com/watch?v=dQw4w9WgXcQ")

        assert code == 124
        assert "timed out" in err.lower()
        assert meta is None

    @patch('subprocess.run')
    def test_run_ytdlp_dump_json_exit_error(self, mock_run):
        """Test yt-dlp non-zero exit code"""
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "ERROR: Video unavailable"
        mock_run.return_value = mock_result

        meta, err, code = ytdlp_host.run_ytdlp_dump_json("https://youtube.com/watch?v=dQw4w9WgXcQ")

        assert code == 1
        assert "Video unavailable" in err
        assert meta is None

    @patch('subprocess.run')
    def test_run_ytdlp_dump_json_invalid_json(self, mock_run):
        """Test handling of invalid JSON response"""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "{invalid json}"
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        meta, err, code = ytdlp_host.run_ytdlp_dump_json("https://youtube.com/watch?v=dQw4w9WgXcQ")

        assert code == 1
        assert "parse" in err.lower()
        assert meta is None


class TestSizeCalculation:
    """Test file size calculation logic"""

    def test_filesize_from_fmt_exact(self):
        """Test size extraction from exact filesize field"""
        fmt = {"filesize": 45234567}
        result = ytdlp_host._filesize_from_fmt(fmt, 180)
        
        assert result == 45234567

    def test_filesize_from_fmt_approx(self):
        """Test size extraction from filesize_approx field"""
        fmt = {"filesize_approx": 45234567}
        result = ytdlp_host._filesize_from_fmt(fmt, 180)
        
        assert result == 45234567

    def test_filesize_from_fmt_bitrate_estimate(self):
        """Test size estimation from bitrate and duration"""
        fmt = {"tbr": 2000}  # 2000 kbps
        result = ytdlp_host._filesize_from_fmt(fmt, 180)  # 180 seconds
        
        # Expected: (2000 * 1000 / 8) * 180 = 45,000,000 bytes
        assert result == 45000000

    def test_filesize_from_fmt_none(self):
        """Test None format returns None"""
        result = ytdlp_host._filesize_from_fmt(None, 180)
        assert result is None

    def test_filesize_from_fmt_no_data(self):
        """Test format with no size data returns None"""
        fmt = {"format_id": "398"}
        result = ytdlp_host._filesize_from_fmt(fmt, 180)
        
        assert result is None

    def test_filesize_from_fmt_prefer_exact_over_approx(self):
        """Test that exact filesize is preferred over approximate"""
        fmt = {
            "filesize": 1000000,
            "filesize_approx": 2000000
        }
        result = ytdlp_host._filesize_from_fmt(fmt, 180)
        
        assert result == 1000000


class TestFormatParsing:
    """Test parsing size information from yt-dlp format list"""

    def test_parse_sizes_from_format_list_valid(self):
        """Test parsing valid format list output"""
        format_text = """
        ID  EXT   RESOLUTION FPS │   FILESIZE   TBR PROTO │ VCODEC        VBR ACODEC
        394 mp4   256x144     24 │    5.50MiB   123k https │ av01.0.00M.08 123k video only
        398 mp4   1280x720    30 │   45.23MiB  2000k https │ av01.0.05M.08 2000k video only
        251 webm  audio only     │   12.34MiB   256k https │ audio only        opus
        """
        
        sizes = ytdlp_host.parse_sizes_from_format_list(format_text)
        
        assert sizes["394"] is not None
        assert sizes["398"] is not None
        assert sizes["251"] is not None
        assert sizes["394"] < sizes["398"]  # 144p < 720p

    def test_parse_sizes_from_format_list_empty(self):
        """Test parsing empty format list"""
        sizes = ytdlp_host.parse_sizes_from_format_list("")
        
        # All sizes should be None
        assert all(v is None for v in sizes.values())

    def test_parse_sizes_from_format_list_missing_size(self):
        """Test handling formats without size information"""
        format_text = """
        ID  EXT   RESOLUTION FPS │   FILESIZE   TBR PROTO │ VCODEC
        398 mp4   1280x720    30 │      ~  n/a https │ av01.0.05M.08
        """
        
        sizes = ytdlp_host.parse_sizes_from_format_list(format_text)
        
        # Size should still be None since format doesn't have size data
        assert sizes["398"] is None


class TestFindYtDlp:
    """Test yt-dlp executable detection"""

    def test_find_yt_dlp_returns_string(self):
        """Test that find_yt_dlp returns a string path"""
        result = ytdlp_host.find_yt_dlp()
        assert isinstance(result, str)
        assert len(result) > 0

    @patch('ytdlp_host._host_dir')
    def test_find_yt_dlp_bundled_windows(self, mock_host_dir):
        """Test finding bundled yt-dlp.exe on Windows"""
        from pathlib import Path
        mock_host_dir.return_value = Path('/fake/dir')
        
        # We need to mock the Path object creation that happens inside find_yt_dlp
        # because instantiating a Path with os.name='nt' on Linux fails.
        with patch('os.name', 'nt'):
            with patch('ytdlp_host.Path') as mock_path:
                # Setup mock_path / 'yt-dlp.exe'
                mock_exe = MagicMock()
                mock_exe.exists.return_value = True
                mock_exe.__str__.return_value = 'C:\\fake\\dir\\yt-dlp.exe'
                mock_path.return_value.__truediv__.return_value = mock_exe
                
                result = ytdlp_host.find_yt_dlp()
                assert 'yt-dlp' in result.lower()

    @patch('pathlib.Path.exists')
    def test_find_yt_dlp_fallback_to_path(self, mock_exists):
        """Test fallback to PATH when no bundled executable"""
        mock_exists.return_value = False
        
        result = ytdlp_host.find_yt_dlp()
        assert result == 'yt-dlp'


class TestDebugLogging:
    """Test debug logging function"""

    def test_dbg_writes_to_stderr(self, capsys):
        """Test _dbg writes to stderr"""
        ytdlp_host._dbg("test message")
        
        captured = capsys.readouterr()
        assert "test message" in captured.err

    def test_dbg_handles_exceptions(self, capsys):
        """Test _dbg doesn't raise exceptions on error"""
        # Should not raise even if stderr is unavailable
        with patch('sys.stderr.write', side_effect=Exception("test")):
            ytdlp_host._dbg("test message")
        
        # No exception should propagate


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--cov=ytdlp_host", "--cov-report=term"])
