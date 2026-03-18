import './fetch';
import { connect } from './ws';
import { checkProxyConfig } from './proxy-config-check';

connect();
checkProxyConfig();
