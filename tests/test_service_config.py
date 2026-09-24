import importlib.util
import json
from pathlib import Path
import socket
import pytest

spec = importlib.util.spec_from_file_location('service_config', Path(__file__).resolve().parents[1]/'termux/configure.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


def test_occupied_port_is_not_reused_or_stopped():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
        listener.listen()
        with pytest.raises(ValueError, match='occupied'):
            config.select_port(str(port), None)
        assert listener.getsockname()[1] == port


def test_automatic_selection_skips_reserved_and_busy_ports(monkeypatch):
    monkeypatch.setattr(config, 'available', lambda port: port == 8093)
    monkeypatch.setattr(config, 'healthy', lambda port: False)
    assert config.select_port(None, 8081, {8091, 8092}) == 8093


def test_saved_running_sunscape_keeps_port(monkeypatch):
    monkeypatch.setattr(config, 'available', lambda port: False)
    monkeypatch.setattr(config, 'healthy', lambda port: port == 8094)
    assert config.select_port(None, 8094) == 8094


def test_reserved_port_is_rejected_even_if_free(monkeypatch):
    monkeypatch.setattr(config, 'available', lambda port: True)
    with pytest.raises(ValueError):
        config.select_port('8080', None, {8080})


def test_save_preserves_other_apps_and_custom_fields(tmp_path, monkeypatch):
    registry = tmp_path/'apps.json'
    registry.write_text(json.dumps({'apps': [{'id':'aycf','port':8080}, {'id':'sunscape','name':'Sunscape','icon':'sun'}]}))
    monkeypatch.setenv('SUNSCAPE_CONFIG_DIR',str(tmp_path/'config'))
    monkeypatch.setenv('AYCF_ADMIN_REGISTRY',str(registry))
    monkeypatch.setenv('SUNSCAPE_APP_DIR',str(tmp_path/'sunscape'))
    monkeypatch.setattr(config,'healthy',lambda port: True)
    monkeypatch.setattr('sys.argv',['configure.py','save','8093'])
    config.main()
    data=json.loads(registry.read_text())
    assert data['apps'][0] == {'id':'aycf','port':8080}
    sun=data['apps'][1]
    assert sun['icon']=='sun'
    assert sun['port']==8093
    assert sun['open_url']=='http://127.0.0.1:8093'
    assert json.loads((tmp_path/'config/service.json').read_text())['port']==8093


def test_failed_health_does_not_change_settings(tmp_path,monkeypatch):
    registry=tmp_path/'apps.json';registry.write_text('{"apps":[]}')
    monkeypatch.setenv('SUNSCAPE_CONFIG_DIR',str(tmp_path/'config'))
    monkeypatch.setenv('AYCF_ADMIN_REGISTRY',str(registry))
    monkeypatch.setattr(config,'healthy',lambda port: False)
    monkeypatch.setattr('sys.argv',['configure.py','save','8093'])
    with pytest.raises(SystemExit): config.main()
    assert registry.read_text()=='{"apps":[]}'
    assert not (tmp_path/'config/service.json').exists()
