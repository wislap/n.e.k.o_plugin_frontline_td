from pathlib import Path


def test_plugin_manifest_exists() -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = root / "plugin.toml"
    assert manifest.is_file()
    text = manifest.read_text(encoding="utf-8")
    assert 'id = "frontline_td"' in text
    assert 'entry = "plugin.plugins.frontline_td:FrontlineTdPlugin"' in text


def test_static_panel_declared_and_built() -> None:
    root = Path(__file__).resolve().parents[1]
    assert (root / "static" / "index.html").is_file()
    text = (root / "plugin.toml").read_text(encoding="utf-8")
    assert 'entry = "static/index.html"' in text
    assert 'mode = "static"' in text
