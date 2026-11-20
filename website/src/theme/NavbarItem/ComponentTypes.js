/**
 * Registers our custom navbar items on top of the default ones.
 */
import ComponentTypes from '@theme-original/NavbarItem/ComponentTypes';
import VersionDropdownNavbarItem from '@site/src/components/VersionDropdownNavbarItem';

export default {
    ...ComponentTypes,
    'custom-versionDropdown': VersionDropdownNavbarItem
};
